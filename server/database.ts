import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Group, Loop, Song } from '../shared/types.js'
import { GROUP_COLORS } from '../shared/types.js'

export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'backline.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      originalName TEXT NOT NULL,
      filename TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      duration REAL NOT NULL,
      groupId TEXT REFERENCES groups(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      bpm INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loops (
      id TEXT PRIMARY KEY,
      songId TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start REAL NOT NULL,
      end REAL NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS loops_song ON loops(songId);
    CREATE INDEX IF NOT EXISTS songs_group ON songs(groupId);
  `)

  // Additive migration: preserve all IDs, media, recording notes, and loop links.
  // Keeping the legacy table names also allows an older app release to read the DB.
  db.exec('BEGIN IMMEDIATE')
  try {
    const columns = db.prepare('PRAGMA table_info(groups)').all() as { name: string }[]
    if (!columns.some(column => column.name === 'notes')) db.exec("ALTER TABLE groups ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
    if (!columns.some(column => column.name === 'updatedAt')) db.exec("ALTER TABLE groups ADD COLUMN updatedAt TEXT NOT NULL DEFAULT ''")
    db.exec("UPDATE groups SET updatedAt = createdAt WHERE updatedAt = ''")
    const ungrouped = db.prepare('SELECT id, title, createdAt, updatedAt FROM songs WHERE groupId IS NULL').all() as
      { id: string; title: string; createdAt: string; updatedAt: string }[]
    for (const recording of ungrouped) {
      const id = randomUUID()
      const count = Number((db.prepare('SELECT COUNT(*) AS count FROM groups').get() as { count: number }).count)
      db.prepare('INSERT INTO groups (id, name, color, createdAt, updatedAt, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, recording.title, GROUP_COLORS[count % GROUP_COLORS.length], recording.createdAt, recording.updatedAt, '')
      db.prepare('UPDATE songs SET groupId = ? WHERE id = ?').run(id, recording.id)
    }
    db.exec('PRAGMA user_version = 2; COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }

  const songFields = `s.id, s.title, s.originalName, s.mimeType, s.size,
    s.duration, s.groupId, s.notes, s.bpm, s.createdAt, s.updatedAt,
    (SELECT COUNT(*) FROM loops l WHERE l.songId = s.id) AS loopCount`

  return {
    db,
    groups: () => db.prepare('SELECT * FROM groups ORDER BY createdAt, id').all() as unknown as Group[],
    songs: () => db.prepare(`SELECT ${songFields} FROM songs s ORDER BY s.createdAt DESC, s.id`).all() as unknown as Song[],
    song: (id: string) => db.prepare(`SELECT ${songFields} FROM songs s WHERE s.id = ?`).get(id) as unknown as Song | undefined,
    file: (id: string) => db.prepare('SELECT filename, mimeType, originalName FROM songs WHERE id = ?').get(id) as
      { filename: string; mimeType: string; originalName: string } | undefined,
    loops: (songId: string) => db.prepare('SELECT * FROM loops WHERE songId = ? ORDER BY start, createdAt').all(songId) as unknown as Loop[],
    addGroup(name: string, color: string): Group {
      const now = new Date().toISOString()
      const group = { id: randomUUID(), name, color, notes: '', createdAt: now, updatedAt: now }
      db.prepare('INSERT INTO groups (id, name, color, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        group.id, group.name, group.color, group.notes, group.createdAt, group.updatedAt,
      )
      return group
    },
    addSong(input: Omit<Song, 'id' | 'createdAt' | 'updatedAt' | 'loopCount'> & { filename: string }): string {
      const id = randomUUID()
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO songs (id, title, originalName, filename, mimeType, size, duration, groupId, notes, bpm, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.title, input.originalName, input.filename, input.mimeType, input.size,
        input.duration, input.groupId, input.notes, input.bpm, now, now,
      )
      return id
    },
  }
}

export type Store = ReturnType<typeof openDatabase>
