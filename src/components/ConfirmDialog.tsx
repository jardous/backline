import { useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import Modal from './Modal'
import { message } from '../lib'

export default function ConfirmDialog({ title, description, onClose, onConfirm }: {
  title: string; description: string; onClose: () => void; onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title={title} description={description} onClose={onClose} busy={busy}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose} disabled={busy}>Keep it</button>
      <button className="button danger" disabled={busy} onClick={async () => {
        setBusy(true)
        try { await onConfirm(); onClose() } catch (error) { setError(message(error)); setBusy(false) }
      }}>{busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}Delete</button></div>
  </Modal>
}
