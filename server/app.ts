import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { openDatabase } from './database.js'
import { setupAuth } from './auth.js'
import { GROUP_COLORS, MAX_UPLOAD_BYTES } from '../shared/types.js'

const audioTypes: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav',
  '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff', '.webm': 'audio/webm',
}

export function createApp(dataDirectory: string, clientDirectory?: string, ownerPassword = process.env.OWNER_PASSWORD) {
  if (ownerPassword && ownerPassword.length < 12) throw new Error('OWNER_PASSWORD must be at least 12 characters.')
  const dataDir = resolve(dataDirectory)
  const uploadsDir = join(dataDir, 'uploads')
  mkdirSync(uploadsDir, { recursive: true })
  const store = openDatabase(dataDir)
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
  })
  // Listening is public; authentication below protects every library mutation.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(403).json({ error: 'Cross-site requests are not allowed.' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '256kb' }))
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
  setupAuth(app, ownerPassword)

  class HttpError extends Error {
    constructor(public status: number, message: string) { super(message) }
  }

  const text = (value: unknown, label: string, max: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
      throw new HttpError(400, `${label} must be between 1 and ${max} characters.`)
    }
    return value.trim()
  }
  const groupId = (value: unknown): string => {
    if (typeof value !== 'string' || !store.groups().some(g => g.id === value)) {
      throw new HttpError(400, 'Choose an existing song for this audio.')
    }
    return value
  }
  const requireSong = (id: string) => {
    const song = store.song(id)
    if (!song) throw new HttpError(404, 'Song not found.')
    return song
  }
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8, fieldSize: 100_000 },
    fileFilter: (_req, file, callback) => {
      if (!audioTypes[extname(file.originalname).toLowerCase()]) {
        callback(new HttpError(400, 'Please upload an audio file (MP3, WAV, M4A, FLAC, OGG, AAC, AIFF, or WebM).'))
      } else callback(null, true)
    },
  })

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.get('/api/library', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ songs: store.songs(), groups: store.groups() })
  })
  app.post('/api/groups', (req, res) => {
    const name = text(req.body.name, 'Song name', 200)
    const color = typeof req.body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color)
      ? req.body.color : GROUP_COLORS[store.groups().length % GROUP_COLORS.length]
    res.status(201).json(store.addGroup(name, color))
  })
  app.patch('/api/groups/:id', (req, res) => {
    const group = store.groups().find(g => g.id === req.params.id)
    if (!group) throw new HttpError(404, 'Song not found.')
    const name = req.body.name === undefined ? group.name : text(req.body.name, 'Song name', 200)
    const notes = req.body.notes === undefined ? group.notes : req.body.notes
    if (typeof notes !== 'string' || notes.length > 20_000) throw new HttpError(400, 'Notes must be under 20,000 characters.')
    store.db.prepare('UPDATE groups SET name = ?, notes = ?, updatedAt = ? WHERE id = ?')
      .run(name, notes, new Date().toISOString(), req.params.id)
    res.json(store.groups().find(g => g.id === req.params.id))
  })
  app.delete('/api/groups/:id', async (req, res) => {
    if (!store.groups().some(g => g.id === req.params.id)) throw new HttpError(404, 'Song not found.')
    const files = store.db.prepare('SELECT filename FROM songs WHERE groupId = ?').all(req.params.id) as { filename: string }[]
    // Older cached clients described group deletion as non-destructive.
    // They must never silently acquire permission to delete attached audio.
    if (files.length && req.body?.deleteRecordings !== true) {
      throw new HttpError(409, 'This song contains audios. Reload the app and explicitly confirm deleting all its audios.')
    }
    store.db.exec('BEGIN IMMEDIATE')
    try {
      store.db.prepare('DELETE FROM songs WHERE groupId = ?').run(req.params.id)
      store.db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id)
      store.db.exec('COMMIT')
    } catch (error) { store.db.exec('ROLLBACK'); throw error }
    // Unreferenced files cannot be served. Keep the DB consistent if cleanup fails.
    await Promise.all(files.map(file => unlink(join(uploadsDir, file.filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.error('Could not clean up deleted recording:', file.filename, error.code)
    })))
    res.status(204).end()
  })
  app.post('/api/songs', upload.single('audio'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose an audio file to upload.')
    try {
      const title = text(req.body.title || req.file.originalname.replace(/\.[^.]+$/, ''), 'Audio name', 200)
      const duration = Number(req.body.duration)
      if (!Number.isFinite(duration) || duration <= 0 || duration > 172800) {
        throw new HttpError(400, 'Could not read the audio duration. Try another audio format.')
      }
      const notes = req.body.notes ?? ''
      if (typeof notes !== 'string' || notes.length > 20_000) throw new HttpError(400, 'Notes must be under 20,000 characters.')
      const id = store.addSong({
        title, originalName: req.file.originalname, filename: req.file.filename,
        mimeType: audioTypes[extname(req.file.originalname).toLowerCase()],
        size: req.file.size, duration, groupId: groupId(req.body.groupId), notes, bpm: null,
      })
      res.status(201).json(store.song(id))
    } catch (error) {
      await unlink(req.file.path).catch(() => {})
      throw error
    }
  })
  app.get('/api/songs/:id', (req, res) => res.json(requireSong(req.params.id)))
  app.patch('/api/songs/:id', (req, res) => {
    const song = requireSong(req.params.id)
    const title = req.body.title === undefined ? song.title : text(req.body.title, 'Audio name', 200)
    const notes = req.body.notes === undefined ? song.notes : req.body.notes
    if (typeof notes !== 'string' || notes.length > 20_000) throw new HttpError(400, 'Notes must be under 20,000 characters.')
    const group = req.body.groupId === undefined ? song.groupId : groupId(req.body.groupId)
    const bpm = req.body.bpm === undefined ? song.bpm : req.body.bpm
    if (bpm !== null && (!Number.isInteger(bpm) || bpm < 20 || bpm > 400)) {
      throw new HttpError(400, 'Tempo must be between 20 and 400 BPM.')
    }
    const duration = req.body.duration === undefined ? song.duration : req.body.duration
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 172800) {
      throw new HttpError(400, 'Invalid audio duration.')
    }
    store.db.prepare('UPDATE songs SET title = ?, notes = ?, groupId = ?, bpm = ?, duration = ?, updatedAt = ? WHERE id = ?')
      .run(title, notes, group, bpm, duration, new Date().toISOString(), song.id)
    res.json(store.song(song.id))
  })
  app.delete('/api/songs/:id', async (req, res) => {
    requireSong(req.params.id)
    const file = store.file(req.params.id)!
    // Remove the media first; a filesystem error must not leave an orphaned upload.
    await unlink(join(uploadsDir, file.filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    store.db.prepare('DELETE FROM songs WHERE id = ?').run(req.params.id)
    res.status(204).end()
  })
  app.get('/api/songs/:id/loops', (req, res) => {
    requireSong(req.params.id)
    res.setHeader('Cache-Control', 'no-store')
    res.json(store.loops(req.params.id))
  })
  const loopValues = (body: Record<string, unknown>, duration: number) => {
    const name = text(body.name, 'Loop name', 100)
    const { start, end } = body
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start)
      || !Number.isFinite(end) || start < 0 || end - start < 0.1 || end > duration + 0.05) {
      throw new HttpError(400, 'Choose a loop at least 0.1 seconds long, within the song.')
    }
    return { name, start, end: Math.min(end, duration) }
  }
  app.post('/api/songs/:id/loops', (req, res) => {
    const song = requireSong(req.params.id)
    const values = loopValues(req.body, song.duration)
    const loop = { id: randomUUID(), songId: song.id, ...values, createdAt: new Date().toISOString() }
    store.db.prepare('INSERT INTO loops (id, songId, name, start, end, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(loop.id, loop.songId, loop.name, loop.start, loop.end, loop.createdAt)
    res.status(201).json(loop)
  })
  app.patch('/api/songs/:songId/loops/:id', (req, res) => {
    const song = requireSong(req.params.songId)
    const previous = store.loops(song.id).find(l => l.id === req.params.id)
    if (!previous) throw new HttpError(404, 'Loop not found.')
    const values = loopValues({ ...previous, ...req.body }, song.duration)
    store.db.prepare('UPDATE loops SET name = ?, start = ?, end = ? WHERE id = ?')
      .run(values.name, values.start, values.end, previous.id)
    res.json({ ...previous, ...values })
  })
  app.delete('/api/songs/:songId/loops/:id', (req, res) => {
    const result = store.db.prepare('DELETE FROM loops WHERE id = ? AND songId = ?').run(req.params.id, req.params.songId)
    if (!result.changes) throw new HttpError(404, 'Loop not found.')
    res.status(204).end()
  })

  const media: RequestHandler = (req, res) => {
    const file = store.file(String(req.params.id))
    if (!file) throw new HttpError(404, 'Audio file not found.')
    res.type(file.mimeType)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(join(uploadsDir, file.filename))
  }
  app.get('/media/:id', media)
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }))

  if (clientDirectory && existsSync(join(clientDirectory, 'index.html'))) {
    app.use(express.static(clientDirectory, { index: false }))
    app.get('/{*path}', (_req, res) => res.sendFile(join(clientDirectory, 'index.html')))
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 150 MB or smaller.' : error.message })
    } else if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
    } else if (error instanceof SyntaxError || error.status === 400) {
      res.status(400).json({ error: 'Invalid request.' })
    } else if (error.status === 404) {
      res.status(404).json({ error: 'File not found.' })
    } else {
      console.error(error)
      res.status(500).json({ error: 'Something went wrong. Please try again.' })
    }
  }
  app.use(errorHandler)
  return { app, store }
}
