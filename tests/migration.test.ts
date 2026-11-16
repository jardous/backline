import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { openDatabase } from '../server/database.js'

test('song-first migration preserves grouped versions, creates songs for ungrouped files, and is idempotent', async () => {
  const directory = await mkdtemp('/tmp/opencode/backline-migration-')
  try {
    await mkdir(join(directory, 'uploads'))
    await writeFile(join(directory, 'uploads', 'original.wav'), 'original audio bytes')
    const legacy = new DatabaseSync(join(directory, 'backline.sqlite'))
    legacy.exec(`
      CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE songs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, originalName TEXT NOT NULL, filename TEXT NOT NULL,
        mimeType TEXT NOT NULL, size INTEGER NOT NULL, duration REAL NOT NULL,
        groupId TEXT REFERENCES groups(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '', bpm INTEGER, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE loops (
        id TEXT PRIMARY KEY, songId TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        name TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, createdAt TEXT NOT NULL
      );
      INSERT INTO groups VALUES ('song1', 'SONG1', '#789978', '2026-11-16T10:00:00Z');
      INSERT INTO songs VALUES ('v1','Demo','demo.wav','original.wav','audio/wav',20,19.2,'song1','Demo cues',100,'2026-11-16T10:00:00Z','2026-11-16T10:00:00Z');
      INSERT INTO songs VALUES ('v2','Live','live.wav','live.wav','audio/wav',20,19.2,'song1','Live cues',100,'2026-11-16T10:00:00Z','2026-11-16T10:00:00Z');
      INSERT INTO songs VALUES ('v3','Previously ungrouped','other.wav','other.wav','audio/wav',20,19.2,NULL,'Keep this note',NULL,'2026-11-16T11:00:00Z','2026-11-16T11:00:00Z');
      INSERT INTO loops VALUES ('loop1','v2','Chorus',2,5,'2026-11-16T10:00:00Z');
    `)
    legacy.close()
    const migrated = openDatabase(directory)
    const newSongId = migrated.song('v3')!.groupId
    try {
      assert.equal(migrated.groups().length, 2)
      assert.equal(migrated.groups().find(item => item.id === 'song1')?.name, 'SONG1')
      assert.equal(migrated.groups().find(item => item.id === 'song1')?.notes, '')
      assert.equal(migrated.songs().filter(item => item.groupId === 'song1').length, 2)
      assert.equal(migrated.song('v2')?.notes, 'Live cues')
      assert.ok(newSongId)
      assert.equal(migrated.groups().find(item => item.id === newSongId)?.name, 'Previously ungrouped')
      assert.equal(migrated.song('v3')?.notes, 'Keep this note')
      assert.equal(migrated.loops('v2')[0].id, 'loop1')
      assert.equal(migrated.db.prepare('PRAGMA user_version').get()?.user_version, 2)
      migrated.db.prepare('UPDATE groups SET notes = ? WHERE id = ?').run('Common song notes', 'song1')
    } finally { migrated.db.close() }
    const reopened = openDatabase(directory)
    try {
      assert.equal(reopened.groups().length, 2)
      assert.equal(reopened.song('v3')?.groupId, newSongId)
      assert.equal(reopened.groups().find(item => item.id === 'song1')?.notes, 'Common song notes')
      assert.equal(reopened.loops('v2')[0].id, 'loop1')
      assert.equal(await readFile(join(directory, 'uploads', 'original.wav'), 'utf8'), 'original audio bytes')
    } finally { reopened.db.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
