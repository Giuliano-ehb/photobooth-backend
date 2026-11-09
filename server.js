require('dotenv').config()
const express = require('express')
const app = express()
/* const port = 3000 */
const port = process.env.PORT || 3000
var cors = require('cors')

app.use(cors())
app.use(express.json())

const { MongoClient, ObjectId } = require("mongodb");

const dbName = "photosphotobooth"


const path = require('path')
const fs = require('fs')
const multer = require('multer')

const uploadDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9).toString(36)}.png`)
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
})

app.use('/uploads', express.static(uploadDir))
app.use(express.static(path.join(__dirname, 'public')))


let photos = null 
const localFile = path.join(__dirname, 'photos-local.json')
const readLocal = () => { try { return JSON.parse(fs.readFileSync(localFile, 'utf8')) } catch { return [] } }
const writeLocal = (list) => fs.writeFileSync(localFile, JSON.stringify(list, null, 2))

async function insertPhoto(doc) {
  if (photos) {
    try {
      const r = await photos.insertOne(doc)
      return { _id: r.insertedId, ...doc }
    } catch (err) {
      console.warn('Mongo mislukt, lokaal bewaard:', err.message)
    }
  }
  const lokaal = { _id: 'local-' + Date.now() + '-' + Math.round(Math.random() * 1e6), ...doc }
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
  return [...uitDb, ...lokaal]
}


app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: !!photos })
})

app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Geen bestand in veld "photo"' })

    const doc = {
      sessie: req.body.sessie || null,
      nummer: Number(req.body.nummer) || 1,
      bestand: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      createdAt: new Date(),
    }
    const saved = await insertPhoto(doc)
    console.log(`Foto ontvangen: sessie ${doc.sessie}, nummer ${doc.nummer} (${photos ? 'database' : 'lokaal bewaard'})`)
    res.status(201).json({ id: saved._id, ...doc })
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
    return
  }
  while (!photos) {
    const client = new MongoClient(process.env.DATABASE_URI, { serverSelectionTimeoutMS: 5000 })
    try {
      await client.connect()
      photos = client.db(dbName).collection('photos')
      console.log('geconnect met database')
    } catch (err) {
      console.warn('Database niet bereikbaar:', err.message)
      await client.close().catch(() => {})
      await new Promise((r) => setTimeout(r, 15000))
    }
  }
}