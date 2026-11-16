import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import {
  ArrowLeft, ArrowRight, AudioLines, Bookmark, Check, Clock3,
  Download, Headphones, Keyboard, Link, LoaderCircle, Minus, Pause,
  Pencil, Play, Plus, Repeat2, RotateCcw, RotateCw, Save, SlidersHorizontal,
  StickyNote, Trash2, Volume2, VolumeX,
} from 'lucide-react'
import type { Group, Loop, Song } from '../../shared/types'
import { api, copyLink, fileSize, message, parseTime, songLink, time } from '../lib'
import { clampLoopPreference, readLoopPreference, writeLoopPreference, type LoopPreference } from '../loopCookies'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'

function TimeField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(time(value, true))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(time(value, true)) }, [value, focused])
  const commit = () => {
    const parsed = parseTime(draft)
    if (parsed !== null && parsed >= 0 && parsed <= max) onChange(parsed)
    setFocused(false)
    setDraft(time(parsed !== null && parsed >= 0 && parsed <= max ? parsed : value, true))
  }
  return <label className="time-field"><span>{label}</span><input aria-label={`Loop ${label.toLowerCase()}`}
    inputMode="decimal" value={draft} onFocus={() => setFocused(true)} onChange={event => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}

export default function Player({ song, groups, isOwner, onBack, onRefresh, onDeleted, notify }: {
  song: Song; groups: Group[]; isOwner: boolean; onBack: () => void; onRefresh: () => Promise<void>;
  onDeleted: () => void; notify: (message: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const wave = useRef<WaveSurfer | null>(null)
  const region = useRef<Region | null>(null)
  const syncing = useRef(false)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(0)
  const [playError, setPlayError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(song.duration)
  const [viewport, setViewport] = useState<[number, number]>([0, song.duration])
  const [position, setPosition] = useState(0)
  const [remembered] = useState(() => readLoopPreference(song.id))
  const initialPreference = clampLoopPreference(remembered, song.duration)
  const [range, setRange] = useState<[number, number]>(() =>
    initialPreference ? [initialPreference.start, initialPreference.end] : [0, Math.min(song.duration, 12)])
  const [repeat, setRepeat] = useState(initialPreference?.repeat ?? false)
  const [preferenceReady, setPreferenceReady] = useState(false)
  const cookieSnapshot = useRef<LoopPreference | null>(null)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(.8)
  const [zoom, setZoom] = useState(1)
  const [loops, setLoops] = useState<Loop[]>([])
  const [loopError, setLoopError] = useState('')
  const [loopsLoading, setLoopsLoading] = useState(true)
  const [activeLoopId, setActiveLoopId] = useState<string | null>(new URLSearchParams(window.location.search).get('loop'))
  const initialLoopId = useRef(activeLoopId)
  const [saveDialog, setSaveDialog] = useState(false)
  const [loopName, setLoopName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deletingLoop, setDeletingLoop] = useState<Loop | null>(null)
  const [deletingSong, setDeletingSong] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(song.notes)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [shortcuts, setShortcuts] = useState(false)
  const playback = useRef({ repeat, range })
  playback.current = { repeat, range }
  const activeLoop = loops.find(loop => loop.id === activeLoopId)
  const group = groups.find(item => item.id === song.groupId)

  const fetchLoops = useCallback(async () => {
    try {
      const result = await api<Loop[]>(`/songs/${song.id}/loops`)
      setLoops(result)
      setLoopError('')
    } catch (error) { setLoopError(message(error)) } finally { setLoopsLoading(false) }
  }, [song.id])
  useEffect(() => {
    void fetchLoops()
    const interval = setInterval(() => { if (!document.hidden) void fetchLoops() }, 15_000)
    return () => clearInterval(interval)
  }, [fetchLoops])
  useEffect(() => { if (!editingNotes) setNotes(song.notes) }, [song.notes, editingNotes])
  useEffect(() => {
    if (!isOwner) { setEditing(false); setSaveDialog(false); setEditingNotes(false); setDeletingLoop(null); setDeletingSong(false) }
  }, [isOwner])

  const setLoopRange = useCallback((start: number, end: number) => {
    const limit = wave.current?.getDuration() || song.duration
    const next: [number, number] = [Math.max(0, Math.min(start, limit - .1)), Math.max(.1, Math.min(end, limit))]
    if (next[1] - next[0] < .1) next[1] = Math.min(limit, next[0] + .1)
    setRange(next)
    playback.current.range = next
    if (region.current) {
      syncing.current = true
      region.current.setOptions({ start: next[0], end: next[1] })
      syncing.current = false
    }
  }, [song.duration])

  useEffect(() => {
    if (!container.current) return
    let disposed = false
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: container.current, height: 168, waveColor: '#66746d', progressColor: '#edb47b',
      cursorColor: '#f5eee2', cursorWidth: 2, barWidth: 3, barGap: 2, barRadius: 3,
      normalize: true, plugins: [regions], sampleRate: 8000,
      autoScroll: true, autoCenter: false,
    })
    wave.current = ws
    ws.setVolume(.8)
    ws.on('loading', setLoading)
    ws.on('ready', total => {
      if (disposed) return
      setDuration(total)
      setViewport([0, total])
      setReady(true)
      const stored = clampLoopPreference(remembered, total)
      const initialRange: [number, number] = stored ? [stored.start, stored.end] : [0, Math.min(total, 12)]
      setRange(initialRange)
      setRepeat(stored?.repeat ?? false)
      playback.current = { repeat: stored?.repeat ?? false, range: initialRange }
      syncing.current = true
      region.current = regions.addRegion({
        start: initialRange[0], end: initialRange[1], color: 'rgba(229, 161, 100, 0.15)',
        minLength: .1, drag: true, resize: true,
      })
      syncing.current = false
      regions.enableDragSelection({ color: 'rgba(229, 161, 100, 0.15)', minLength: .1 }, 5)
    })
    regions.on('region-created', created => {
      regions.getRegions().forEach(item => { if (item !== created) item.remove() })
      region.current = created
      if (!syncing.current) {
        setRange([created.start, created.end])
        setActiveLoopId(null)
        setRepeat(true)
      }
    })
    regions.on('region-update', changed => {
      if (!syncing.current) {
        const next: [number, number] = [changed.start, changed.end]
        playback.current.range = next
        setRange(next)
        setRepeat(true)
      }
    })
    ws.on('scroll', (start, end) => setViewport([start, Math.min(end, ws.getDuration())]))
    ws.on('zoom', pixelsPerSecond => {
      const scale = Math.max(pixelsPerSecond, ws.getWidth() / ws.getDuration())
      const start = ws.getScroll() / scale
      setViewport([start, Math.min(ws.getDuration(), start + ws.getWidth() / scale)])
    })
    ws.on('timeupdate', current => {
      if (disposed) return
      const state = playback.current
      if (ws.isPlaying() && state.repeat && current >= state.range[1] - .015) {
        ws.setTime(state.range[0])
        setPosition(state.range[0])
      } else setPosition(current)
    })
    ws.on('finish', () => {
      if (playback.current.repeat && !disposed) {
        ws.setTime(playback.current.range[0])
        void ws.play().catch(error => { if (!disposed) setPlayError(message(error)) })
      }
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('error', error => { if (!disposed) setPlayError(`This audio could not be played. ${error.message}`) })
    void ws.load(`/media/${song.id}`).catch(error => { if (!disposed) setPlayError(message(error)) })
    return () => { disposed = true; ws.destroy(); wave.current = null; region.current = null }
  }, [song.id])

  useEffect(() => {
    const id = initialLoopId.current
    if (!ready || preferenceReady || (id && loopsLoading)) return
    // An explicitly shared loop takes precedence over this browser's last range.
    if (id) {
      const loop = loops.find(item => item.id === id)
      if (loop) {
        setLoopRange(loop.start, loop.end)
        setRepeat(true)
        playback.current.repeat = true
        wave.current?.setTime(loop.start)
      } else {
        notify('That shared loop no longer exists. You can still practice the song.')
        setActiveLoopId(null)
      }
    }
    initialLoopId.current = null
    setPreferenceReady(true)
  }, [ready, preferenceReady, loops, loopsLoading, setLoopRange, notify])

  useEffect(() => {
    if (!ready || !preferenceReady) return
    const value = { start: range[0], end: range[1], repeat }
    cookieSnapshot.current = value
    const timer = setTimeout(() => writeLoopPreference(song.id, value), 300)
    return () => clearTimeout(timer)
  }, [ready, preferenceReady, range, repeat, song.id])
  useEffect(() => {
    const flush = () => {
      if (cookieSnapshot.current) writeLoopPreference(song.id, cookieSnapshot.current)
    }
    const visibility = () => { if (document.hidden) flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
      flush()
    }
  }, [song.id])

  const togglePlay = useCallback(() => {
    const ws = wave.current
    if (!ws || !ready) return
    setPlayError('')
    if (ws.isPlaying()) { ws.pause(); return }
    const state = playback.current
    if (state.repeat && (ws.getCurrentTime() < state.range[0] || ws.getCurrentTime() >= state.range[1])) ws.setTime(state.range[0])
    void ws.play().catch(error => setPlayError(message(error)))
  }, [ready])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (element.closest('input, textarea, select, button, dialog, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey || !ready) return
      if (event.code === 'Space') { event.preventDefault(); togglePlay() }
      else if (event.key.toLowerCase() === 'l') setRepeat(value => !value)
      else if (event.key === '[') { setLoopRange(wave.current!.getCurrentTime(), playback.current.range[1]); setRepeat(true) }
      else if (event.key === ']') { setLoopRange(playback.current.range[0], wave.current!.getCurrentTime()); setRepeat(true) }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        wave.current!.setTime(Math.max(0, Math.min(duration, wave.current!.getCurrentTime() + (event.key === 'ArrowLeft' ? -5 : 5))))
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [ready, duration, togglePlay, setLoopRange])

  useEffect(() => { wave.current?.setPlaybackRate(speed, true) }, [speed])
  useEffect(() => { wave.current?.setVolume(volume) }, [volume])
  useEffect(() => {
    region.current?.setOptions({ color: repeat ? 'rgba(229, 161, 100, 0.22)' : 'rgba(229, 161, 100, 0.08)' })
  }, [repeat, ready])

  const loadLoop = (loop: Loop, play = false) => {
    setActiveLoopId(loop.id)
    setLoopRange(loop.start, loop.end)
    playback.current.repeat = true
    setRepeat(true)
    wave.current?.setTime(loop.start)
    if (play) void wave.current?.play().catch(error => setPlayError(message(error)))
  }
  const share = async (loopId?: string) => {
    try { await copyLink(songLink(song, loopId)); notify(loopId ? 'Loop link copied. Everyone starts at the same part.' : 'Audio link copied.') }
    catch (error) { notify(message(error)) }
  }
  const saveLoop = async (asNew = false) => {
    setSaving(true)
    setSaveError('')
    try {
      const update = activeLoop && !asNew
      const result = await api<Loop>(`/songs/${song.id}/loops${update ? `/${activeLoop.id}` : ''}`, {
        method: update ? 'PATCH' : 'POST', body: JSON.stringify({ name: loopName, start: range[0], end: range[1] }),
      })
      setActiveLoopId(result.id)
      await fetchLoops()
      await onRefresh()
      setSaveDialog(false)
      notify(update ? 'Shared loop updated.' : 'Loop saved for the whole band.')
    } catch (error) { setSaveError(message(error)) } finally { setSaving(false) }
  }
  const adjustZoom = (amount: number) => {
    if (!ready || !container.current) return
    const next = Math.max(1, Math.min(16, zoom * amount))
    setZoom(next)
    wave.current?.zoom(next === 1 ? 0 : container.current.clientWidth / duration * next)
  }
  const rangeChanged = activeLoop && (Math.abs(activeLoop.start - range[0]) > .05 || Math.abs(activeLoop.end - range[1]) > .05)

  return <div className="player-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} />Back to song</button>
    <section className="player-heading"><div className="player-song-art"><AudioLines size={33} /></div>
      <div className="player-heading-copy"><div className="eyebrow">AUDIO{group ? ` · ${group.name}` : ''}</div><h1>{song.title}</h1>
        <div className="song-metadata"><span>{song.originalName.split('.').pop()?.toUpperCase()} AUDIO</span><i />{time(duration)}<i />
          {song.bpm ? <span>{song.bpm} BPM</span> : <span>{fileSize(song.size)}</span>}
          {group && <><i /><span className="group-pill"><b style={{ backgroundColor: group.color }} />{group.name}</span></>}</div>
      </div>
      <div className="player-heading-actions"><button className="button secondary" onClick={() => void share()}><Link size={15} />Share audio</button>
        {isOwner && <button className="icon-button" title="Edit audio details" aria-label="Edit audio details" onClick={() => setEditing(true)}><SlidersHorizontal size={20} /></button>}</div>
    </section>
    <div className="editor-layout">
      <div className="editor-main">
        <section className="player-card">
          <div className="waveform-panel"><div className="waveform-topline"><span><span className={`playing-dot ${playing ? 'pulsing' : ''}`} />{playing ? 'FINDING THE GROOVE' : 'MAKE IT SECOND NATURE'}</span>
            <div className="zoom-controls"><button aria-label="Zoom out waveform" disabled={!ready || zoom <= 1} onClick={() => adjustZoom(.5)}><Minus size={15} /></button>
              <span>{zoom}×</span><button aria-label="Zoom in waveform" disabled={!ready || zoom >= 16} onClick={() => adjustZoom(2)}><Plus size={15} /></button></div></div>
            <div className="waveform-container" ref={container} data-testid="waveform" />
            {!ready && !playError && <div className="waveform-loading"><LoaderCircle size={22} className="spin" /><span>Finding your waveform… {loading}%</span></div>}
            <div className="waveform-timeline">{Array.from({ length: 7 }, (_, i) => <span key={i}>{time(viewport[0] + (viewport[1] - viewport[0]) * i / 6)}</span>)}</div>
            <div className="waveform-hint"><span><Headphones size={13} />Click to seek. Drag to select. Repeat until it clicks.</span><span>{repeat ? 'LOOP ON' : 'FULL SONG'}</span></div>
          </div>
          {playError && <div className="form-error player-error" role="alert">{playError} <a href={`/media/${song.id}`} target="_blank" rel="noreferrer">Open original audio</a></div>}
          <div className="transport"><div className="playback-time"><strong>{time(position, true)}</strong><span>/ {time(duration)}</span></div>
            <div className="transport-buttons"><button className="icon-button" aria-label="Back 5 seconds" disabled={!ready} onClick={() => wave.current?.setTime(Math.max(0, position - 5))}><RotateCcw size={20} /><small>5</small></button>
              <button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!ready} onClick={togglePlay}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
              <button className="icon-button" aria-label="Forward 5 seconds" disabled={!ready} onClick={() => wave.current?.setTime(Math.min(duration, position + 5))}><RotateCw size={20} /><small>5</small></button></div>
            <div className="volume-control"><button className="icon-button" aria-label={volume ? 'Mute' : 'Unmute'} onClick={() => setVolume(volume ? 0 : .8)}>
              {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><input type="range" min="0" max="1" step=".01" value={volume} aria-label="Volume" onChange={event => setVolume(Number(event.target.value))} /></div>
          </div>
          <div className="loop-controls">
            <button className={`loop-toggle ${repeat ? 'is-on' : ''}`} aria-pressed={repeat} disabled={!ready} onClick={() => setRepeat(value => !value)}><Repeat2 size={18} /><span>Loop {repeat ? 'on' : 'off'}</span></button>
            <div className="range-fields"><TimeField label="Start" value={range[0]} max={duration} onChange={value => { setLoopRange(Math.min(value, range[1] - .1), range[1]); setRepeat(true) }} />
              <ArrowRight size={14} /><TimeField label="End" value={range[1]} max={duration} onChange={value => { setLoopRange(range[0], Math.max(value, range[0] + .1)); setRepeat(true) }} /></div>
            <label className="speed-control"><span>SPEED</span><select aria-label="Playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
              {[.5, .65, .75, .85, 1, 1.15, 1.25, 1.5].map(value => <option key={value} value={value}>{value}×{value === 1 ? ' Normal' : ''}</option>)}</select></label>
          </div>
          <div className="loop-action-bar"><span><Clock3 size={14} />{time(range[1] - range[0], true)} selected{rangeChanged ? ' · Unsaved changes' : ''}</span>
            {isOwner ? <button className="text-button" disabled={!ready} onClick={() => { setLoopName(activeLoop?.name || ''); setSaveError(''); setSaveDialog(true) }}><Bookmark size={15} />{activeLoop ? 'Save loop changes' : 'Save this loop'}</button> :
              <span className="personal-loop-note">Remembered in this browser.</span>}</div>
        </section>
        <section className="notes-card"><div className="card-heading"><h2><StickyNote size={18} />Audio notes</h2>
          {isOwner && !editingNotes && <button className="text-button" onClick={() => setEditingNotes(true)}><Pencil size={14} />Edit notes</button>}</div>
          {editingNotes ? <div className="notes-editor"><textarea aria-label="Audio notes" rows={7} maxLength={20_000} value={notes} onChange={event => setNotes(event.target.value)}
            placeholder="Chord changes, cues, things to listen for… this is the place." autoFocus />
            {notesError && <p className="form-error" role="alert">{notesError}</p>}
            <div className="notes-editor-footer"><small>{notes.length.toLocaleString()} / 20,000</small><div><button className="button secondary" disabled={notesSaving} onClick={() => { setNotes(song.notes); setEditingNotes(false) }}>Cancel</button>
              <button className="button primary" disabled={notesSaving} onClick={async () => {
                setNotesSaving(true)
                setNotesError('')
                try {
                  await api(`/songs/${song.id}`, { method: 'PATCH', body: JSON.stringify({ notes }) })
                  await onRefresh()
                  setEditingNotes(false)
                  notify('Audio notes saved for the band.')
                } catch (error) { setNotesError(message(error)) } finally { setNotesSaving(false) }
              }}>{notesSaving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save notes</button></div></div></div> :
            song.notes ? <div className="song-notes">{song.notes}</div> : <div className="notes-empty"><p>No notes yet. Just the music.</p>
              <span>{isOwner ? 'Add chord changes, rehearsal cues, or a reminder for next time.' : 'The owner’s rehearsal notes will appear here.'}</span></div>}
        </section>
        <div className="editor-footnote"><button onClick={() => setShortcuts(true)}><Keyboard size={15} />Keyboard shortcuts</button><span>Loop ranges are remembered in this browser.</span></div>
      </div>
      <aside className="saved-loops-panel"><section className="saved-loops-card"><div className="card-heading"><h2><Bookmark size={18} />Shared loops<span className="count-badge">{loops.length}</span></h2>
        {isOwner && <button className="icon-button" aria-label="Save current loop" disabled={!ready} onClick={() => { setLoopName(''); setActiveLoopId(null); setSaveError(''); setSaveDialog(true) }}><Plus size={18} /></button>}</div>
        <p className="loops-description">The parts worth playing one more time.</p>
        {loopError ? <div className="form-error">{loopError}<button className="text-button" onClick={() => void fetchLoops()}>Retry</button></div> :
          loopsLoading ? <div className="small-loading"><LoaderCircle className="spin" size={20} /></div> :
          loops.length ? <div className="saved-loops-list">{loops.map((loop, index) =>
            <div className={`saved-loop ${activeLoopId === loop.id ? 'selected' : ''}`} key={loop.id}>
              <button className="saved-loop-main" disabled={!ready} onClick={() => loadLoop(loop)}>
                <span className="loop-index">{String(index + 1).padStart(2, '0')}</span><span><strong>{loop.name}</strong>
                  <small>{time(loop.start, true)} <span>—</span> {time(loop.end, true)}</small></span>
                <span className="saved-loop-length">{time(loop.end - loop.start)}</span></button>
              <div className="saved-loop-actions"><button className="text-button" disabled={!ready} onClick={() => loadLoop(loop, true)}><Play size={12} fill="currentColor" />Practice</button>
                <button className="icon-button" aria-label={`Share loop ${loop.name}`} title="Copy loop link" onClick={() => void share(loop.id)}><Link size={14} /></button>
                {isOwner && <button className="icon-button" aria-label={`Delete loop ${loop.name}`} title="Delete loop" onClick={() => setDeletingLoop(loop)}><Trash2 size={14} /></button>}</div>
            </div>)}</div> : <div className="loops-empty"><span><Repeat2 size={27} strokeWidth={1.5} /></span><h3>Find your repeat-worthy bit.</h3>
            <p>{isOwner ? 'Select a section on the waveform and save it here for everyone.' : 'Drag on the waveform to practice a section. The owner’s saved loops will show up here.'}</p></div>}
      </section>
        <div className="practice-tip"><span className="tip-label">A LITTLE PRACTICE TIP</span><h3>Small loops.<br /> Big breakthroughs.</h3>
          <p>Start slower than you think you need to. Get it comfortable, then bring the tempo back up.</p><span className="tip-decoration" aria-hidden="true">↻</span></div>
        <a className="original-audio-link" href={`/media/${song.id}`} target="_blank" rel="noreferrer"><Download size={14} />Open original audio</a>
      </aside>
    </div>
    {saveDialog && isOwner && <Modal title={activeLoop ? 'Keep the good part.' : 'A little section. A lot of progress.'}
      description={`${time(range[0], true)} – ${time(range[1], true)} · Saved loops are shared with everyone in the band.`}
      onClose={() => setSaveDialog(false)} busy={saving}>
      <form onSubmit={event => { event.preventDefault(); void saveLoop() }}>
        <label className="field">Loop name<input autoFocus required maxLength={100} value={loopName} onChange={event => setLoopName(event.target.value)}
          placeholder="e.g. Chorus transition" disabled={saving} /></label>
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="modal-actions">{activeLoop && <button type="button" className="button secondary" disabled={saving || !loopName.trim()} onClick={() => void saveLoop(true)}>Save as new</button>}
          <button className="button primary" disabled={saving || !loopName.trim()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{activeLoop ? 'Update shared loop' : 'Save shared loop'}</button></div>
      </form></Modal>}
    {deletingLoop && <ConfirmDialog title={`Delete “${deletingLoop.name}”?`} description="This saved loop will be removed for everyone. The song will stay."
      onClose={() => setDeletingLoop(null)} onConfirm={async () => {
        await api(`/songs/${song.id}/loops/${deletingLoop.id}`, { method: 'DELETE' })
        if (activeLoopId === deletingLoop.id) setActiveLoopId(null)
        await fetchLoops(); await onRefresh(); notify('Shared loop deleted.')
      }} />}
    {editing && isOwner && <RecordingDetails song={song} groups={groups} onClose={() => setEditing(false)} onSaved={async () => {
      await onRefresh(); notify('Audio details updated.')
    }} onDelete={() => { setEditing(false); setDeletingSong(true) }} />}
    {deletingSong && <ConfirmDialog title={`Delete “${song.title}”?`} description="This audio, its notes, and saved loops will be permanently removed. The song and its other audios will stay. This can’t be undone."
      onClose={() => setDeletingSong(false)} onConfirm={async () => {
        wave.current?.pause()
        await api(`/songs/${song.id}`, { method: 'DELETE' }); onDeleted(); notify('Audio removed. The song and its other audios were kept.')
      }} />}
    {shortcuts && <Modal title="Less clicking. More playing." description="Keyboard shortcuts for your practice session." onClose={() => setShortcuts(false)}>
      <div className="shortcuts-list"><span>Play / pause<kbd>Space</kbd></span><span>Toggle looping<kbd>L</kbd></span><span>Set loop start at playhead<kbd>[</kbd></span>
        <span>Set loop end at playhead<kbd>]</kbd></span><span>Seek 5 seconds<kbd>← / →</kbd></span></div>
    </Modal>}
  </div>
}

function RecordingDetails({ song, groups, onClose, onSaved, onDelete }: {
  song: Song; groups: Group[]; onClose: () => void; onSaved: () => Promise<void>; onDelete: () => void
}) {
  const [title, setTitle] = useState(song.title)
  const [groupId, setGroupId] = useState(song.groupId || '')
  const [bpm, setBpm] = useState(song.bpm?.toString() || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="The audio details." description="Name this audio, set its tempo, or move it to another song." onClose={onClose} busy={busy}>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('')
      try {
        await api(`/songs/${song.id}`, { method: 'PATCH', body: JSON.stringify({ title, groupId: groupId || null, bpm: bpm ? Number(bpm) : null }) })
        await onSaved(); onClose()
      } catch (error) { setError(message(error)) } finally { setBusy(false) }
    }}>
      <label className="field">Audio name<input autoFocus required maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
      <div className="details-fields"><label className="field">Song<select aria-label="Song" required value={groupId} disabled={busy} onChange={event => setGroupId(event.target.value)}>
        {groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        <label className="field">Tempo <span className="optional">BPM</span><input type="number" min={20} max={400} placeholder="Not set" value={bpm} disabled={busy} onChange={event => setBpm(event.target.value)} /></label></div>
      <p className="file-details">{song.originalName} · {fileSize(song.size)}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="text-button delete-text" disabled={busy} onClick={onDelete}><Trash2 size={14} />Delete audio</button>
        <button className="button primary" disabled={busy || !title.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save details</button></div>
    </form>
  </Modal>
}
