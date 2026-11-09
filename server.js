require('dotenv').config()
const express = require('express')
const app = express()
/* const port = 3000 */
const port = process.env.PORT || 3000
var cors = require('cors')

app.use(cors())
app.use(express.json())

const { MongoClient, ObjectId, Binary } = require("mongodb");

const dbName = "photosphotobooth"


const path = require('path')
const fs = require('fs')
const multer = require('multer')

const uploadDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

// Upload blijft in het geheugen, daarna gaat de afbeelding naar MongoDB
// (of naar schijf als Mongo niet bereikbaar is)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
})

app.use('/uploads', express.static(uploadDir))
app.use(express.static(path.join(__dirname, 'docs')))


let photos = null
let images = null

// Pas uploaden als de databaseverbinding klaar is (of na 20s toch lokaal bewaren).
// Zo gaat een foto die tijdens een koude start op Render binnenkomt niet verloren.
let dbKlaar
const dbVerbonden = new Promise((resolve) => { dbKlaar = resolve })
const localFile = path.join(__dirname, 'photos-local.json')
const readLocal = () => { try { return JSON.parse(fs.readFileSync(localFile, 'utf8')) } catch { return [] } }
const writeLocal = (list) => fs.writeFileSync(localFile, JSON.stringify(list, null, 2))

// Records waarvan het bestand op schijf niet meer bestaat (bv. na een herstart op Render) worden verborgen
const bestaat = (p) =>
  !p.url || !p.url.startsWith('/uploads/') || fs.existsSync(path.join(uploadDir, path.basename(p.url)))

async function insertPhoto(doc, buffer) {
  if (!photos && process.env.DATABASE_URI) {
    await Promise.race([dbVerbonden, new Promise((r) => setTimeout(r, 20000))])
  }
  if (photos && images) {
    try {
      const img = await images.insertOne({
        data: new Binary(buffer),
        contentType: 'image/png',
        createdAt: new Date(),
      })
      const dbDoc = { ...doc, bestand: String(img.insertedId), url: `/api/images/${img.insertedId}` }
      const r = await photos.insertOne(dbDoc)
      return { _id: r.insertedId, ...dbDoc }
    } catch (err) {
      console.warn('Mongo mislukt, lokaal bewaard:', err.message)
    }
  }
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9).toString(36)}.png`
  fs.writeFileSync(path.join(uploadDir, filename), buffer)
  const lokaal = {
    _id: 'local-' + Date.now() + '-' + Math.round(Math.random() * 1e6),
    ...doc,
    bestand: filename,
    url: `/uploads/${filename}`,
  }
  const list = readLocal()
  list.push(lokaal)
  writeLocal(list)
  return lokaal
}

async function findPhotos(filter = {}) {
  let uitDb = []
  if (photos) {
    try { uitDb = await photos.find(filter).toArray() } catch (err) { console.warn('Mongo lezen mislukt:', err.message) }
  }
  const lokaal = readLocal().filter((p) => !filter.sessie || p.sessie === filter.sessie)
  return [...uitDb, ...lokaal].filter(bestaat)
}


app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: !!photos })
})

app.get('/api/images/:id', async (req, res) => {
  try {
    if (!images || !ObjectId.isValid(req.params.id)) return res.status(404).end()
    const doc = await images.findOne({ _id: new ObjectId(req.params.id) })
    if (!doc) return res.status(404).end()
    const buf = Buffer.from(doc.data.read(0, doc.data.length()))
    res.set('Content-Type', doc.contentType || 'image/png')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(buf)
  } catch (err) {
    console.error(err)
    res.status(500).end()
  }
})

app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Geen bestand in veld "photo"' })

    const doc = {
      sessie: req.body.sessie || null,
      nummer: Number(req.body.nummer) || 1,
      createdAt: new Date(),
    }
    const saved = await insertPhoto(doc, req.file.buffer)
    console.log(`Foto ontvangen: sessie ${doc.sessie}, nummer ${doc.nummer} (${saved.url.startsWith('/api/images/') ? 'database' : 'lokaal bewaard'})`)
    res.status(201).json({ id: saved._id, ...doc, bestand: saved.bestand, url: saved.url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Opslaan mislukt' })
  }
})

app.get('/api/photos', async (req, res) => {
  try {
    const lijst = (await findPhotos())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 200)
    res.json(lijst)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ophalen mislukt' })
  }
})

app.get('/api/sessions/:sessie', async (req, res) => {
  try {
    const lijst = (await findPhotos({ sessie: req.params.sessie })).sort((a, b) => a.nummer - b.nummer)
    res.json(lijst)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ophalen mislukt' })
  }
})


app.listen(port, '0.0.0.0', () => {
  console.log(`Backend draait op http://localhost:${port}`)
  connectLoop()
})

async function connectLoop() {
  if (!process.env.DATABASE_URI) {
    console.error("DATABASE_URI ontbreekt, foto's worden alleen lokaal bewaard.")
    dbKlaar()
    return
  }
  while (!photos) {
    const client = new MongoClient(process.env.DATABASE_URI, { serverSelectionTimeoutMS: 5000 })
    try {
      await client.connect()
      const db = client.db(dbName)
      images = db.collection('images')
      photos = db.collection('photos')
      dbKlaar()
      console.log('geconnect met database')
    } catch (err) {
      console.warn('Database niet bereikbaar:', err.message)
      await client.close().catch(() => {})
      await new Promise((r) => setTimeout(r, 15000))
    }
  }
}