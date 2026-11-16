import { useRef, useState, type DragEvent } from 'react'
import { Check, FileAudio, LoaderCircle, UploadCloud, X } from 'lucide-react'
import Modal from './Modal'
import { audioDuration, fileSize, message, uploadAudio } from '../lib'
import { MAX_UPLOAD_BYTES, type Group, type Song } from '../../shared/types'

type QueuedFile = { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; progress: number; error?: string }

export default function UploadDialog({ groups, initialGroup, onClose, onUploaded }: {
  groups: Group[]; initialGroup: string | null; onClose: () => void; onUploaded: (song: Song) => void
}) {
  const [files, setFiles] = useState<QueuedFile[]>([])
  const [groupId, setGroupId] = useState(initialGroup || '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const addFiles = (incoming: FileList | File[]) => {
    setError('')
    const list = Array.from(incoming)
    const oversized = list.filter(file => file.size > MAX_UPLOAD_BYTES)
    if (oversized.length) setError(`${oversized.map(f => f.name).join(', ')} exceeds the 150 MB limit.`)
    setFiles(previous => [...previous, ...list.filter(file => file.size <= MAX_UPLOAD_BYTES)
      .filter(file => !previous.some(item => item.file.name === file.name && item.file.size === file.size))
      .map(file => ({ file, status: 'pending' as const, progress: 0 }))])
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!busy) addFiles(event.dataTransfer.files)
  }
  const update = (index: number, patch: Partial<QueuedFile>) => setFiles(previous => previous.map((file, i) => i === index ? { ...file, ...patch } : file))
  const upload = async () => {
    setBusy(true)
    setError('')
    let failures = 0
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'done') continue
      update(i, { status: 'uploading', error: undefined })
      try {
        const file = files[i].file
        const duration = await audioDuration(file)
        const data = new FormData()
        data.append('audio', file)
        data.append('duration', String(duration))
        data.append('groupId', groupId)
        data.append('notes', notes)
        const song = await uploadAudio(data, progress => update(i, { progress }))
        update(i, { status: 'done', progress: 100 })
        onUploaded(song)
      } catch (error) {
        failures++
        update(i, { status: 'error', error: message(error) })
      }
    }
    setBusy(false)
    if (!failures) onClose()
    else setError('Some files could not be uploaded. Your successful uploads are already in the library.')
  }
  const remaining = files.filter(file => file.status !== 'done').length
  return <Modal title="Add audios." description="Attach audios to a song. Each audio gets its own player and saved loops."
    onClose={onClose} busy={busy} wide>
    <input ref={input} type="file" multiple accept="audio/*,.m4a,.flac,.opus,.aif,.aiff,.webm" className="sr-only"
      aria-label="Choose audio files" onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = '' }} />
    <button type="button" className={`upload-drop ${dragging ? 'dragging' : ''}`} disabled={busy}
      onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)} onDrop={drop}>
      <span className="upload-icon"><UploadCloud size={27} /></span>
      <strong>Drop your audio files here</strong>
      <span>or <span className="accent">browse files</span></span>
      <small>MP3, WAV, M4A, FLAC & more · Up to 150 MB each</small>
    </button>
    {files.length > 0 && <div className="upload-queue" aria-live="polite">
      {files.map((item, index) => <div className={`upload-item ${item.status === 'error' ? 'has-error' : ''}`} key={`${item.file.name}-${index}`}>
        <FileAudio size={20} />
        <div className="upload-file-info"><strong>{item.file.name}</strong>
          <small>{item.error || (item.status === 'uploading' ? `Uploading… ${item.progress}%` : item.status === 'done' ? 'Ready to practice' : fileSize(item.file.size))}</small>
          {item.status === 'uploading' && <progress value={item.progress} max={100} aria-label={`Uploading ${item.file.name}`} />}
        </div>
        {item.status === 'done' ? <Check size={18} className="success" /> : <button type="button" className="icon-button" disabled={busy}
          aria-label={`Remove ${item.file.name}`} onClick={() => setFiles(items => items.filter((_, i) => index !== i))}><X size={16} /></button>}
      </div>)}
    </div>}
    <label className="field">Song
      <select aria-label="Song" required value={groupId} onChange={event => setGroupId(event.target.value)} disabled={busy}>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </label>
    <label className="field">Audio notes <span className="optional">optional · applies to these audios</span>
      <textarea rows={3} maxLength={20_000} placeholder="What should the band listen for?" value={notes}
        disabled={busy} onChange={event => setNotes(event.target.value)} />
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="button primary" disabled={busy || !remaining || !groupId} onClick={upload}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <UploadCloud size={17} />}
        {busy ? 'Uploading…' : remaining > 1 ? `Upload ${remaining} audios` : 'Upload audio'}
      </button></div>
  </Modal>
}
