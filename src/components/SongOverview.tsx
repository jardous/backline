import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, AudioLines, Check, ChevronRight, FileAudio, Link, LoaderCircle, Music2, Pencil, Play, Plus, Repeat2, StickyNote, Trash2 } from 'lucide-react'
import type { Recording, SongGroup } from '../../shared/types'
import { api, copyLink, fileSize, message, time } from '../lib'
import ConfirmDialog from './ConfirmDialog'

export default function SongOverview({ song, recordings, isOwner, onBack, onOpen, onUpload, onEdit, onRefresh, onDeleted, notify, onDemo, demoBusy }: {
  song: SongGroup; recordings: Recording[]; isOwner: boolean; onBack: () => void; onOpen: (recording: Recording) => void;
  onUpload: () => void; onEdit: () => void; onRefresh: () => Promise<void>; onDeleted: () => void;
  notify: (message: string) => void; onDemo: () => Promise<void>; demoBusy: boolean
}) {
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(song.notes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!editing) setNotes(song.notes) }, [song.notes, editing])
  useEffect(() => { if (!isOwner) { setEditing(false); setDeleting(false) } }, [isOwner])
  const audios = [...recordings].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title))
  const loopCount = recordings.reduce((sum, recording) => sum + recording.loopCount, 0)
  const share = async () => {
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('song', song.id)
    try { await copyLink(url.href); notify('Song link copied, with all its audios.') }
    catch (error) { notify(message(error)) }
  }
  return <div className="player-page song-overview">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} />Back to library</button>
    <section className="player-heading">
      <div className="player-song-art" style={{ color: song.color, backgroundColor: `${song.color}20` }}><Music2 size={33} /></div>
      <div className="player-heading-copy"><div className="eyebrow">ONE SONG. ALL ITS AUDIOS.</div><h1>{song.name}</h1>
        <div className="song-metadata"><span>{recordings.length} {recordings.length === 1 ? 'AUDIO' : 'AUDIOS'}</span><i /><span>{loopCount} shared {loopCount === 1 ? 'loop' : 'loops'}</span></div>
      </div>
      <div className="player-heading-actions">
        <button className="button secondary" onClick={() => void share()}><Link size={15} />Share song</button>
        {isOwner && <><button className="icon-button" aria-label="Rename song" title="Rename song" onClick={onEdit}><Pencil size={18} /></button>
          <button className="icon-button" aria-label="Delete song" title="Delete song and all audios" onClick={() => setDeleting(true)}><Trash2 size={18} /></button></>}
      </div>
    </section>
    <div className="song-overview-layout">
      <section className="versions-section">
        <div className="section-topline"><div className="section-title"><h2>Audios</h2><span className="count-badge">{recordings.length}</span></div>
          {isOwner && <button className="button primary" onClick={onUpload}><Plus size={16} />Add audio</button>}</div>
        <p className="versions-description">Choose an audio to practice.</p>
        {audios.length > 0 ? <div className="song-list recording-list">
          <div className="recording-table-heading"><span>AUDIO</span><span>LOOPS</span><span>LENGTH</span><span /></div>
          {audios.map((recording, index) => <button className="recording-row" key={recording.id} onClick={() => onOpen(recording)}>
            <div className="song-info"><span className={`song-art art-${index % 4}`}><AudioLines size={23} /><span className="song-art-play"><Play size={16} fill="currentColor" /></span></span>
              <span className="song-titles"><strong>{recording.title}</strong><small>{recording.notes.replace(/\n/g, ' ').slice(0, 90) || `${recording.originalName.split('.').pop()?.toUpperCase()} · ${fileSize(recording.size)} · Added ${new Date(recording.createdAt).toLocaleDateString()}`}</small></span></div>
            <span className="song-loop-count"><Repeat2 size={15} />{recording.loopCount || '—'}</span><span className="song-duration">{time(recording.duration)}</span><ChevronRight size={17} className="row-arrow" />
          </button>)}
        </div> : <div className="empty-state versions-empty">
          <span className="versions-empty-icon"><FileAudio size={31} strokeWidth={1.5} /></span><h2>A place for all your audios.</h2>
          <p>{isOwner ? 'Add your first audio. All audios uploaded here stay together under this song.' : 'The owner hasn’t added any audios to this song yet.'}</p>
          {isOwner && <div className="empty-actions"><button className="button primary" onClick={onUpload}><Plus size={16} />Add the first audio</button>
            <button className="text-button" disabled={demoBusy} onClick={() => void onDemo()}>{demoBusy ? <LoaderCircle className="spin" size={14} /> : <Play size={13} />}Try with a demo</button></div>}
        </div>}
        {audios.length > 0 && <div className="version-hint"><ArrowUpRight size={15} /><span>Select an audio to open its waveform, practice loops, and notes.</span></div>}
      </section>
      <aside className="song-context">
        <section className="notes-card song-level-notes">
          <div className="card-heading"><h2><StickyNote size={18} />Song notes</h2>
            {isOwner && !editing && <button className="text-button" onClick={() => { setEditing(true); setError('') }}><Pencil size={14} />Edit notes</button>}</div>
          <p className="notes-scope">Shared across all audios.</p>
          {editing ? <div className="notes-editor">
            <textarea aria-label="Song notes" rows={9} maxLength={20_000} value={notes} onChange={event => setNotes(event.target.value)}
              placeholder="Chords, structure, rehearsal cues… the things that belong to the whole song." autoFocus />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="notes-editor-footer"><div>
              <button className="button secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              <button className="button primary" disabled={saving} onClick={async () => {
                setSaving(true); setError('')
                try {
                  await api(`/groups/${song.id}`, { method: 'PATCH', body: JSON.stringify({ notes }) })
                  await onRefresh(); setEditing(false); notify('Song notes saved for all audios.')
                } catch (error) { setError(message(error)) } finally { setSaving(false) }
              }}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Save notes</button>
            </div></div></div> : song.notes ? <div className="song-notes">{song.notes}</div> :
            <div className="notes-empty"><p>No song notes yet.</p><span>{isOwner ? 'Keep common chords, cues, and ideas here. Each audio can also have its own notes.' : 'Rehearsal notes for the whole song will appear here.'}</span></div>}
        </section>
        <div className="practice-tip"><span className="tip-label">ALL YOUR AUDIOS TOGETHER</span><h3>Everything you need.<br /> One song.</h3>
          <p>Keep your audios together. Each audio has its own notes and saved loops.</p></div>
      </aside>
    </div>
    {deleting && isOwner && <ConfirmDialog title={`Delete “${song.name}”?`}
      description={`This permanently deletes the song, all ${recordings.length} attached ${recordings.length === 1 ? 'audio' : 'audios'}, their notes, and saved loops for the whole band. This can’t be undone.`}
      onClose={() => setDeleting(false)} onConfirm={async () => {
        await api(`/groups/${song.id}`, { method: 'DELETE', body: JSON.stringify({ deleteRecordings: true }) })
        onDeleted(); notify('Song and its audios deleted.')
      }} />}
  </div>
}
