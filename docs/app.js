const TUNNEL = 'https://cannon-marine-vcr-socks.trycloudflare.com';

const CONFIG = {
  API_BASE: (new URLSearchParams(location.search).get('api')
    || (location.hostname.endsWith('github.io') ? TUNNEL
    : location.port === '3000' ? location.origin
    : `http://${location.hostname || 'localhost'}:3000`)).replace(/\/+$/, ''),
  PHOTOS_ENDPOINT: '/api/photos',
  POLL_MS: 4000,
  DEMO_FALLBACK: false,
  STRIP_SIZE: 3,
};


let photos = [];
let view = 'strips';        
let newestFirst = true;
let seenIds = new Set();
let firstLoad = true;
let lastSignature = '';
let hasRendered = false;
let currentIndex = -1;
let lbList = [];

const $ = (id) => document.getElementById(id);
const gallery = $('gallery');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Data ---------- */
function absoluteUrl(src) {
  if (!src) return '';
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  return CONFIG.API_BASE + '/' + String(src).replace(/^\/+/, '');
}

function normalize(item) {
  const id = String(item._id?.$oid || item._id || item.id || item.bestand);
  const src = absoluteUrl(item.url || (item.bestand && 'uploads/' + item.bestand));
  return {
    id,
    sessie: item.sessie || null,
    nummer: Number(item.nummer) || 1,
    src,
    date: new Date(item.createdAt || Date.now()),
  };
}

async function fetchPhotos() {
  try {
    const res = await fetch(CONFIG.API_BASE + CONFIG.PHOTOS_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const arr = Array.isArray(json) ? json : json.photos || json.data || [];
    setStatus('ok', 'Live verbonden met de photobooth');
    return arr.map(normalize).filter((p) => p.src);
  } catch (err) {
    console.warn('Backend niet bereikbaar:', err);
    if (CONFIG.DEMO_FALLBACK) {
      setStatus('demo', 'Demo-modus – backend niet bereikbaar');
      return demoPhotos();
    }
    setStatus('err', `Backend niet bereikbaar op ${CONFIG.API_BASE} (${err.message})`);
    return photos;
  }
}

function setStatus(kind, text) {
  $('status').className = 'status ' + kind;
  $('statusText').textContent = text;
}


let demoCache = null;
function demoPhotos() {
  if (demoCache) return demoCache;
  const colors = ['#e3000b', '#006db7', '#ffd500', '#00a651', '#ff7a00', '#7b3fe4'];
  demoCache = [];
  for (let s = 0; s < 4; s++) {
    for (let n = 1; n <= 3; n++) {
      const i = s * 3 + n;
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 480;
      const g = cv.getContext('2d');
      g.fillStyle = colors[i % colors.length]; g.fillRect(0, 0, 640, 480);
      for (let y = 0; y < 480; y += 40) for (let x = 0; x < 640; x += 40) {
        const v = Math.sin((x + i * 60) / 90) * Math.cos((y - i * 40) / 70);
        g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) * 0.35})`;
        g.fillRect(x, y, 40, 40);
        g.beginPath(); g.arc(x + 20, y + 20, 12, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fill();
        g.strokeStyle = 'rgba(0,0,0,.18)'; g.stroke();
      }
      demoCache.push({
        id: 'demo-' + i, sessie: 'demo-' + s, nummer: n,
        src: cv.toDataURL('image/png'),
        date: new Date(Date.now() - s * 3600e3 * 6 - (3 - n) * 8000),
      });
    }
  }
  return demoCache;
}


function buildStrips() {
  const map = new Map();
  photos.forEach((p) => {
    const key = p.sessie || 'solo-' + p.id;
    if (!map.has(key)) map.set(key, { key, photos: [], date: p.date, isNew: false });
    const s = map.get(key);
    s.photos.push(p);
    if (p.date > s.date) s.date = p.date;
    if (p.isNew) s.isNew = true;
  });
  map.forEach((s) => s.photos.sort((a, b) => a.nummer - b.nummer));
  return [...map.values()];
}

function currentList() {
  const list = view === 'strips' ? buildStrips() : [...photos];
  return list.sort((a, b) => (newestFirst ? b.date - a.date : a.date - b.date));
}


const fmt = (d) => d.toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function render() {
  const list = currentList();
  $('count').textContent = list.length;
  $('countLabel').textContent = view === 'strips' ? 'fotostrips' : "foto's";
  $('empty').hidden = list.length > 0;
  gallery.classList.toggle('as-strips', view === 'strips');
  gallery.innerHTML = '';

  list.forEach((item, i) => {
    const el = document.createElement('article');
    el.className = 'brick' + (view === 'strips' ? ' strip' : '');
    el.style.animationDelay = Math.min(i * 50, 600) + 'ms';
    el.tabIndex = 0;

    let imgs;
    if (view === 'strips') {
      imgs = '';
      for (let n = 1; n <= CONFIG.STRIP_SIZE; n++) {
        const p = item.photos.find((x) => x.nummer === n);
        imgs += p
          ? `<img loading="lazy" alt="Foto ${n}" src="${esc(p.src)}">`
          : `<div class="slot-wait">Foto ${n}…</div>`;
      }
    } else {
      imgs = `<img loading="lazy" alt="Foto van ${fmt(item.date)}" src="${esc(item.src)}">`;
    }
    el.innerHTML = `
      ${item.isNew ? '<span class="badge-new">NIEUW!</span>' : ''}
      <div class="imgs">${imgs}</div>
      <div class="meta"><span>${fmt(item.date)}</span><span>#${list.length - i}</span></div>`;
    el.addEventListener('click', () => openLightbox(i));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openLightbox(i); });
    gallery.appendChild(el);
  });
}

function skeletons() {
  gallery.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
}


async function load() {
  const list = await fetchPhotos();
  list.forEach((p) => { p.isNew = !firstLoad && !seenIds.has(p.id); });
  list.forEach((p) => seenIds.add(p.id));
  photos = list;
  firstLoad = false;
  const sig = list.map((p) => p.id).join(',');
  if (sig !== lastSignature || !hasRendered) {
    lastSignature = sig;
    hasRendered = true;
    render();
  }
}


function openLightbox(i) {
  lbList = currentList();
  currentIndex = i;
  const item = lbList[i];
  const ps = view === 'strips' ? item.photos : [item];
  $('lbBody').className = 'lb-body' + (view === 'strips' ? ' lb-strip' : '');
  $('lbBody').innerHTML = ps.map((p) => `<img alt="Foto ${p.nummer}" src="${esc(p.src)}">`).join('');
  $('lbDate').textContent = fmt(item.date);
  $('lbDownload').textContent = view === 'strips' ? 'Download strip' : 'Download';
  $('lbDownload').disabled = false;
  $('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLightbox() { $('lightbox').hidden = true; document.body.style.overflow = ''; }
function step(d) {
  if (!lbList.length) return;
  openLightbox((currentIndex + d + lbList.length) % lbList.length);
}


function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

async function downloadCurrent() {
  const btn = $('lbDownload');
  const item = lbList[currentIndex];
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Bezig…';
  try {
    if (view === 'photos') {
      const blob = await (await fetch(item.src)).blob();
      saveBlob(blob, `brickbooth-${item.id}.png`);
    } else {
      // Fotostrip samenstellen op een canvas
      const imgs = await Promise.all(item.photos.map((p) => loadImg(p.src)));
      const W = 640, pad = 36, gap = 24, foot = 90;
      const hs = imgs.map((im) => Math.round((W * im.naturalHeight) / im.naturalWidth));
      const H = pad + hs.reduce((a, h) => a + h + gap, 0) + foot - gap + 10;
      const cv = document.createElement('canvas');
      cv.width = W + pad * 2; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#e3000b'; g.fillRect(0, 0, cv.width, cv.height);
      let y = pad;
      imgs.forEach((im, k) => {
        g.fillStyle = '#fff'; g.fillRect(pad - 8, y - 8, W + 16, hs[k] + 16);
        g.drawImage(im, pad, y, W, hs[k]);
        y += hs[k] + gap;
      });
      g.fillStyle = '#ffd500'; g.font = '56px "Lilita One", Impact, sans-serif'; g.textAlign = 'center';
      g.fillText('BRICK BOOTH', cv.width / 2, H - 30);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      saveBlob(blob, `brickbooth-strip-${item.key}.png`);
    }
    btn.textContent = old;
  } catch (err) {
    console.error(err);
    btn.textContent = 'Downloaden mislukt';
    setTimeout(() => { btn.textContent = old; }, 2500);
  }
  btn.disabled = false;
}

/* ---------- Events ---------- */
$('lbClose').onclick = closeLightbox;
$('lbPrev').onclick = () => step(-1);
$('lbNext').onclick = () => step(1);
$('lbDownload').onclick = downloadCurrent;
$('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if ($('lightbox').hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

$('refreshBtn').onclick = load;
$('sortBtn').onclick = () => {
  newestFirst = !newestFirst;
  $('sortBtn').textContent = newestFirst ? 'Nieuwste eerst' : 'Oudste eerst';
  render();
};
document.querySelectorAll('[data-view]').forEach((b) => {
  b.onclick = () => {
    view = b.dataset.view;
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
    render();
  };
});

/* ---------- Start ---------- */
skeletons();
load();
if (CONFIG.POLL_MS > 0) setInterval(load, CONFIG.POLL_MS);