const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');

const app  = express();
const PORT = 3000;

// ── SET YOUR CLOUD PASSWORD AND VIDEO PIN HERE ────────────────────────────────
const CLOUD_PASSWORD = 'your-cloud-password';
const VIDEO_PIN      = '1234';
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_ROOT = '/mnt/hdd/video';
const CLOUD_ROOT = '/mnt/hdd/cloud';
const VIDEO_EXT  = /\.(mp4|mkv|avi|mov|webm)$/i;

if (!fs.existsSync(CLOUD_ROOT)) fs.mkdirSync(CLOUD_ROOT, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/covers', express.static(VIDEO_ROOT));

// ── Persistent file-based sessions ───────────────────────────────────────────
const SESSIONS_FILE = path.join(__dirname, '.sessions.json');
const SESSION_TTL   = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now  = Date.now();
    return new Map(Object.entries(data).filter(([, exp]) => exp > now));
  } catch { return new Map(); }
}
function saveSessions(map) {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(map))); } catch {}
}
const sessions = loadSessions();

// ── Purge expired sessions (every hour) ──────────────────────────────────────
function purgeSessions() {
  const now = Date.now();
  let changed = false;
  for (const [tok, exp] of sessions) {
    if (exp <= now) { sessions.delete(tok); changed = true; }
  }
  if (changed) saveSessions(sessions);
}
setInterval(purgeSessions, 60 * 60 * 1000);

// ── Utility: safe path (blocks directory traversal) ──────────────────────────
function safePath(root, rel) {
  const resolved = path.resolve(root, rel || '');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Invalid path');
  return resolved;
}

// ── Cloud authentication middleware ──────────────────────────────────────────
function cloudAuth(req, res, next) {
  const token = req.headers['x-cloud-token'] || req.query.token;
  if (token && sessions.has(token) && sessions.get(token) > Date.now()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Multer: upload to temp directory, moved after auth check ─────────────────
const tmpUploadDir = path.join(CLOUD_ROOT, '.tmp');
if (!fs.existsSync(tmpUploadDir)) fs.mkdirSync(tmpUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpUploadDir),
  filename:    (req, file, cb) => cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } }); // max 5 GB

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO API
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/library', videoAuth, (req, res) => {
  const library = { film: [], serie: [], video: [] };

  const filmDir = path.join(VIDEO_ROOT, 'Film');
  if (fs.existsSync(filmDir)) {
    for (const entry of fs.readdirSync(filmDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const moviePath = path.join(filmDir, entry.name);
      const files = fs.readdirSync(moviePath).filter(f => VIDEO_EXT.test(f));
      if (!files.length) continue;
      library.film.push({
        title: entry.name,
        file:  `Film/${entry.name}/${files[0]}`,
        cover: fs.existsSync(path.join(moviePath, 'cover.jpg'))
          ? `/covers/Film/${encodeURIComponent(entry.name)}/cover.jpg` : null,
      });
    }
  }

  const serieDir = path.join(VIDEO_ROOT, 'Serie');
  if (fs.existsSync(serieDir)) {
    for (const serie of fs.readdirSync(serieDir, { withFileTypes: true })) {
      if (!serie.isDirectory()) continue;
      const seriePath = path.join(serieDir, serie.name);
      const allFiles  = fs.readdirSync(seriePath).filter(f => VIDEO_EXT.test(f)).sort();
      const seasons   = {};
      for (const f of allFiles) {
        const match  = f.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
        const season = match ? parseInt(match[1]) : 1;
        if (!seasons[season]) seasons[season] = [];
        seasons[season].push({ file: `Serie/${serie.name}/${f}`, label: f.replace(VIDEO_EXT, '') });
      }
      if (!Object.keys(seasons).length) continue;
      library.serie.push({
        title: serie.name,
        cover: fs.existsSync(path.join(seriePath, 'cover.jpg'))
          ? `/covers/Serie/${encodeURIComponent(serie.name)}/cover.jpg` : null,
        seasons,
      });
    }
  }

  const videoDir = path.join(VIDEO_ROOT, 'Video');
  if (fs.existsSync(videoDir)) {
    for (const f of fs.readdirSync(videoDir).filter(f => VIDEO_EXT.test(f))) {
      library.video.push({ title: f.replace(VIDEO_EXT, ''), file: `Video/${f}`, cover: null });
    }
  }

  res.json(library);
});

app.get('/stream/*', videoAuth, (req, res) => {
  let filePath;
  try { filePath = safePath(VIDEO_ROOT, req.params[0]); }
  catch { return res.status(400).send('Invalid path'); }
  if (!fs.existsSync(filePath)) return res.status(404).send('Video not found');
  const stat  = fs.statSync(filePath);
  const range = req.headers.range;
  if (!range) return res.status(416).send('Range header required');
  const parts     = range.replace('bytes=', '').split('-');
  const start     = parseInt(parts[0], 10);
  const end       = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024, stat.size - 1);
  const mime = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska',
    '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  }[path.extname(filePath).toLowerCase()] || 'video/mp4';
  res.writeHead(206, {
    'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges':  'bytes',
    'Content-Length': end - start + 1,
    'Content-Type':   mime,
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

// ── MKV subtitle tracks ───────────────────────────────────────────────────────

// List subtitle tracks (text only, filters out PGS/DVD image-based tracks)
app.get('/api/video/subtitles/tracks', videoAuth, (req, res) => {
  try {
    const filePath = safePath(VIDEO_ROOT, req.query.path || '');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    if (path.extname(filePath).toLowerCase() !== '.mkv') return res.json([]);
    const out  = execSync(
      `ffprobe -v quiet -print_format json -show_streams -select_streams s "${filePath}"`,
      { timeout: 10000 }
    ).toString();
    const data = JSON.parse(out);
    const TEXT_CODECS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
    const tracks = (data.streams || [])
      .filter(s => TEXT_CODECS.has(s.codec_name))
      .map((s, i) => ({
        trackIndex: i,
        language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'und',
        title:    (s.tags && (s.tags.title    || s.tags.TITLE))    || '',
        codec:    s.codec_name,
      }));
    res.json(tracks);
  } catch { res.json([]); } // ffprobe not installed or invalid file → empty array
});

// Stream subtitle as WebVTT (ffmpeg extracts on-the-fly)
app.get('/api/video/subtitles/stream', videoAuth, (req, res) => {
  let filePath;
  try { filePath = safePath(VIDEO_ROOT, req.query.path || ''); }
  catch { return res.status(400).send('Invalid path'); }
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  const trackIndex = parseInt(req.query.track || '0', 10);
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  const ff = spawn('ffmpeg', ['-i', filePath, '-map', `0:s:${trackIndex}`, '-f', 'webvtt', '-']);
  ff.stdout.pipe(res);
  ff.stderr.on('data', () => {}); // discard stderr
  ff.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  req.on('close', () => { try { ff.kill(); } catch {} });
});

// ── MKV audio tracks ──────────────────────────────────────────────────────────

// List audio tracks
app.get('/api/video/audio/tracks', videoAuth, (req, res) => {
  try {
    const filePath = safePath(VIDEO_ROOT, req.query.path || '');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    if (path.extname(filePath).toLowerCase() !== '.mkv') return res.json([]);
    const out  = execSync(
      `ffprobe -v quiet -print_format json -show_streams -select_streams a "${filePath}"`,
      { timeout: 10000 }
    ).toString();
    const data = JSON.parse(out);
    const tracks = (data.streams || []).map((s, i) => ({
      trackIndex: i,
      language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'und',
      title:    (s.tags && (s.tags.title    || s.tags.TITLE))    || '',
      codec:    s.codec_name,
      channels: s.channels || 2,
    }));
    res.json(tracks);
  } catch { res.json([]); }
});

// Stream video with selected audio track re-encoded to AAC (ffmpeg on-the-fly)
app.get('/stream-audio/*', videoAuth, (req, res) => {
  let filePath;
  try { filePath = safePath(VIDEO_ROOT, req.params[0]); }
  catch { return res.status(400).send('Invalid path'); }
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  const trackIndex = parseInt(req.query.track || '0', 10);
  const startSec   = parseFloat(req.query.start  || '0');

  // Detect audio codec of the requested track to decide whether to copy or transcode
  const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus']);
  let audioCodec = 'aac'; // fallback: transcode
  try {
    const probe = execSync(
      `ffprobe -v quiet -print_format json -show_streams -select_streams a "${filePath}"`,
      { timeout: 10000 }
    ).toString();
    const streams = JSON.parse(probe).streams || [];
    if (streams[trackIndex]) {
      const codec = streams[trackIndex].codec_name;
      if (BROWSER_AUDIO.has(codec)) audioCodec = 'copy';
    }
  } catch {}

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  const args = [];
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push(
    '-i', filePath,
    '-map', '0:v:0',
    '-map', `0:a:${trackIndex}`,
    '-c:v', 'copy',
    '-c:a', audioCodec,
    ...(audioCodec === 'aac' ? ['-b:a', '192k'] : []),
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1',
  );
  const ff = spawn('ffmpeg', args);
  ff.stdout.pipe(res);
  ff.stderr.on('data', () => {});
  ff.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  req.on('close', () => { try { ff.kill('SIGKILL'); } catch {} });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLOUD API
// ═══════════════════════════════════════════════════════════════════════════════

// Cloud login
app.post('/api/cloud/auth', (req, res) => {
  if (req.body.password === CLOUD_PASSWORD) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.set(token, Date.now() + SESSION_TTL);
    saveSessions(sessions);
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false });
  }
});

// Cloud logout — invalidates token server-side
app.post('/api/cloud/logout', (req, res) => {
  const token = req.headers['x-cloud-token'];
  if (token) { sessions.delete(token); saveSessions(sessions); }
  res.json({ ok: true });
});

// Video login (PIN)
app.post('/api/video/auth', (req, res) => {
  if (req.body.pin === VIDEO_PIN) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.set(token, Date.now() + SESSION_TTL);
    saveSessions(sessions);
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false });
  }
});

// Video authentication middleware
function videoAuth(req, res, next) {
  const token = req.headers['x-video-token'] || req.query.token;
  if (token && sessions.has(token) && sessions.get(token) > Date.now()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// Video logout
app.post('/api/video/logout', (req, res) => {
  const token = req.headers['x-video-token'];
  if (token) { sessions.delete(token); saveSessions(sessions); }
  res.json({ ok: true });
});

// List files
app.get('/api/cloud/list', cloudAuth, (req, res) => {
  try {
    const dir   = safePath(CLOUD_ROOT, req.query.path || '');
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.name !== '.tmp')
      .map(entry => {
        const stat = fs.statSync(path.join(dir, entry.name));
        return { name: entry.name, isDir: entry.isDirectory(), size: stat.size, mtime: stat.mtimeMs };
      });
    res.json(items);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Download
app.get('/api/cloud/download', cloudAuth, (req, res) => {
  try {
    const filePath = safePath(CLOUD_ROOT, req.query.path || '');
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const stat  = fs.statSync(filePath);
    const fname = path.basename(filePath);
    const range = req.headers.range;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const parts = range.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
        'Content-Type':   'application/octet-stream',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Inline preview (no forced download, supports range for video)
app.get('/api/cloud/preview', cloudAuth, (req, res) => {
  try {
    const filePath = safePath(CLOUD_ROOT, req.query.path || '');
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const stat = fs.statSync(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const mimes = {
      '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
      '.gif':'image/gif',  '.webp':'image/webp',  '.svg':'image/svg+xml',
      '.mp4':'video/mp4',  '.mkv':'video/x-matroska', '.webm':'video/webm',
      '.avi':'video/x-msvideo', '.mov':'video/quicktime',
      '.pdf':'application/pdf',
      '.txt':'text/plain;charset=utf-8', '.md':'text/plain;charset=utf-8',
      '.json':'application/json',        '.js':'text/javascript',
      '.ts':'text/plain;charset=utf-8',  '.py':'text/plain;charset=utf-8',
      '.html':'text/plain;charset=utf-8','.css':'text/css',
      '.csv':'text/plain;charset=utf-8',
    };
    const mime = mimes[ext] || 'application/octet-stream';
    // Range support for video
    const range = req.headers.range;
    if (range && mime.startsWith('video/')) {
      const parts = range.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024, stat.size - 1);
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   mime,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Accept-Ranges', 'bytes');
      res.sendFile(filePath);
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Upload — auth checked BEFORE multer via middleware; multer writes to .tmp, then moved
app.post('/api/cloud/upload', cloudAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  try {
    const dest = safePath(CLOUD_ROOT, req.body.path || req.file.originalname);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(req.file.path, dest);
    res.json({ ok: true });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: e.message });
  }
});

// New folder
app.post('/api/cloud/mkdir', cloudAuth, (req, res) => {
  try {
    fs.mkdirSync(safePath(CLOUD_ROOT, req.body.path || ''), { recursive: true });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete
app.post('/api/cloud/delete', cloudAuth, (req, res) => {
  try {
    const target = safePath(CLOUD_ROOT, req.body.path || '');
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
    fs.statSync(target).isDirectory()
      ? fs.rmSync(target, { recursive: true })
      : fs.unlinkSync(target);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Rename / Move
app.post('/api/cloud/rename', cloudAuth, (req, res) => {
  try {
    const oldPath = safePath(CLOUD_ROOT, req.body.oldPath || '');
    const newPath = safePath(CLOUD_ROOT, req.body.newPath || '');
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'An item with this name already exists at the destination' });
    const destDir = path.dirname(newPath);
    if (!fs.existsSync(destDir)) return res.status(400).json({ error: 'Destination folder does not exist' });
    fs.renameSync(oldPath, newPath);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO FILE MANAGEMENT API (manage video library from the Cloud interface)
// Uses cloudAuth — accessible only with the cloud password
// ═══════════════════════════════════════════════════════════════════════════════

// List video files
app.get('/api/video/files/list', cloudAuth, (req, res) => {
  try {
    const dir   = safePath(VIDEO_ROOT, req.query.path || '');
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(entry => {
        const stat = fs.statSync(path.join(dir, entry.name));
        return { name: entry.name, isDir: entry.isDirectory(), size: stat.size, mtime: stat.mtimeMs };
      });
    res.json(items);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Download video file
app.get('/api/video/files/download', cloudAuth, (req, res) => {
  try {
    const filePath = safePath(VIDEO_ROOT, req.query.path || '');
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const stat  = fs.statSync(filePath);
    const fname = path.basename(filePath);
    const range = req.headers.range;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const parts = range.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
        'Content-Type':   'application/octet-stream',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Inline video file preview (with range support for video)
app.get('/api/video/files/preview', cloudAuth, (req, res) => {
  try {
    const filePath = safePath(VIDEO_ROOT, req.query.path || '');
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const stat = fs.statSync(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const mimes = {
      '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
      '.gif':'image/gif',  '.webp':'image/webp',  '.svg':'image/svg+xml',
      '.mp4':'video/mp4',  '.mkv':'video/x-matroska', '.webm':'video/webm',
      '.avi':'video/x-msvideo', '.mov':'video/quicktime',
      '.txt':'text/plain;charset=utf-8', '.md':'text/plain;charset=utf-8',
    };
    const mime = mimes[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && mime.startsWith('video/')) {
      const parts = range.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024, stat.size - 1);
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   mime,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Accept-Ranges', 'bytes');
      res.sendFile(filePath);
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Upload video file — multer writes to .tmp, then moves to VIDEO_ROOT
app.post('/api/video/files/upload', cloudAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  try {
    const dest = safePath(VIDEO_ROOT, req.body.path || req.file.originalname);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(req.file.path, dest);
    res.json({ ok: true });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: e.message });
  }
});

// New video folder
app.post('/api/video/files/mkdir', cloudAuth, (req, res) => {
  try {
    fs.mkdirSync(safePath(VIDEO_ROOT, req.body.path || ''), { recursive: true });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete video file/folder
app.post('/api/video/files/delete', cloudAuth, (req, res) => {
  try {
    const target = safePath(VIDEO_ROOT, req.body.path || '');
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
    fs.statSync(target).isDirectory()
      ? fs.rmSync(target, { recursive: true })
      : fs.unlinkSync(target);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Rename / Move video file
app.post('/api/video/files/rename', cloudAuth, (req, res) => {
  try {
    const oldPath = safePath(VIDEO_ROOT, req.body.oldPath || '');
    const newPath = safePath(VIDEO_ROOT, req.body.newPath || '');
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'An item with this name already exists at the destination' });
    const destDir = path.dirname(newPath);
    if (!fs.existsSync(destDir)) return res.status(400).json({ error: 'Destination folder does not exist' });
    fs.renameSync(oldPath, newPath);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM API — no auth required (local info only, no sensitive data)
// ═══════════════════════════════════════════════════════════════════════════════

const { execSync, spawn } = require('child_process');

function execSafe(cmd) {
  try { return execSync(cmd, { timeout: 3000 }).toString().trim(); } catch { return ''; }
}

// Recursively calculate folder size in bytes
function dirSize(dirPath) {
  try {
    const out = execSync(`du -sb "${dirPath}" 2>/dev/null`, { timeout: 5000 }).toString().trim();
    return parseInt(out.split('\t')[0]) || 0;
  } catch { return 0; }
}

app.get('/api/system', (req, res) => {
  try {
    // ── CPU ──────────────────────────────────────────────────────────────────
    // Read /proc/stat twice 200ms apart to calculate real usage
    function cpuTimes() {
      const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
      const [, user, nice, system, idle, iowait, irq, softirq] = line.map(Number);
      const total = user + nice + system + idle + iowait + irq + softirq;
      return { idle, total };
    }
    const c1 = cpuTimes();
    // Synchronous 200ms pause — acceptable for an admin call
    execSync('sleep 0.2');
    const c2 = cpuTimes();
    const cpuPct = Math.round(((c2.total - c1.total - (c2.idle - c1.idle)) / (c2.total - c1.total)) * 100);

    // ── RAM + SWAP ────────────────────────────────────────────────────────────
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const memTotal  = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)[1]) * 1024;
    const memAvail  = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)[1]) * 1024;
    const memUsed   = memTotal - memAvail;
    const swapTotal = parseInt((memInfo.match(/SwapTotal:\s+(\d+)/) || [0,0])[1]) * 1024;
    const swapFree  = parseInt((memInfo.match(/SwapFree:\s+(\d+)/)  || [0,0])[1]) * 1024;
    const swapUsed  = swapTotal - swapFree;

    // ── TEMPERATURE ───────────────────────────────────────────────────────────
    let tempC = null;
    try {
      const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
      tempC = (parseInt(raw) / 1000).toFixed(1);
    } catch {}

    // ── UPTIME ───────────────────────────────────────────────────────────────
    const uptimeSec = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    const uptimeDays  = Math.floor(uptimeSec / 86400);
    const uptimeHours = Math.floor((uptimeSec % 86400) / 3600);
    const uptimeMins  = Math.floor((uptimeSec % 3600) / 60);

    // ── CPU LOAD AVERAGE ──────────────────────────────────────────────────────
    const loadAvg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3);

    // ── DISK /mnt/hdd ─────────────────────────────────────────────────────────
    let disk = null;
    try {
      const dfOut = execSync("df -B1 /mnt/hdd 2>/dev/null | tail -1", { timeout: 3000 }).toString().trim().split(/\s+/);
      if (dfOut.length >= 4) {
        disk = {
          total: parseInt(dfOut[1]),
          used:  parseInt(dfOut[2]),
          avail: parseInt(dfOut[3]),
        };
      }
    } catch {}

    // ── SECTION SIZES ─────────────────────────────────────────────────────────
    const videoSize = disk ? dirSize(VIDEO_ROOT) : 0;
    const cloudSize = disk ? dirSize(CLOUD_ROOT) : 0;

    // ── HOSTNAME + IP ─────────────────────────────────────────────────────────
    const hostname = execSafe('hostname');
    const ip       = execSafe("hostname -I | awk '{print $1}'");

    // ── CPU MODEL ─────────────────────────────────────────────────────────────
    let cpuModel = '';
    try {
      const hw = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const m  = hw.match(/Model\s*:\s*(.+)/);
      if (m) cpuModel = m[1].trim();
      else {
        const m2 = hw.match(/Hardware\s*:\s*(.+)/);
        if (m2) cpuModel = m2[1].trim();
      }
    } catch {}

    res.json({
      cpu:      { pct: cpuPct, model: cpuModel, loadAvg },
      ram:      { total: memTotal, used: memUsed, avail: memAvail },
      swap:     { total: swapTotal, used: swapUsed, free: swapFree },
      temp:     tempC ? parseFloat(tempC) : null,
      uptime:   { days: uptimeDays, hours: uptimeHours, mins: uptimeMins, secs: Math.round(uptimeSec) },
      disk,
      sections: { video: videoSize, cloud: cloudSize },
      hostname,
      ip,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT API — proxy to local Ollama (localhost:11434)
// chat.html uses relative paths so it works both locally and via Tailscale
// ═══════════════════════════════════════════════════════════════════════════════
const http = require('http');

function ollamaProxy(method, ollamaPath, body, res) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    hostname: 'localhost',
    port: 11434,
    path: ollamaPath,
    method,
    headers: { 'Content-Type': 'application/json' },
    timeout: 600000, // 10 minutes — small models can be slow
  };
  if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

  const req = http.request(options, ollamaRes => {
    res.status(ollamaRes.statusCode);
    res.setHeader('Content-Type', ollamaRes.headers['content-type'] || 'application/json');
    ollamaRes.pipe(res);
  });
  req.on('error', () => {
    if (!res.headersSent) res.status(503).json({ error: 'Ollama unreachable' });
  });
  req.on('timeout', () => {
    req.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'Ollama timeout' });
  });
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// List available models
app.get('/api/chat/tags', (req, res) => {
  ollamaProxy('GET', '/api/tags', null, res);
});

// Send message to Ollama
app.post('/api/chat/send', (req, res) => {
  ollamaProxy('POST', '/api/chat', req.body, res);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Homelab → http://0.0.0.0:${PORT}`));
