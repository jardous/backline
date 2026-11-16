import { useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import Modal from './Modal'
import { api, message } from '../lib'
import { GROUP_COLORS, type Group } from '../../shared/types'

export default function GroupDialog({ group, onClose, onSaved }: {
  group?: Group; onClose: () => void; onSaved: (group: Group) => void
}) {
  const [name, setName] = useState(group?.name || '')
  const [color, setColor] = useState<string>(group?.color || GROUP_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title={group ? 'Rename song' : 'Give your song a home.'}
    description={group ? 'All audios stay attached to this song.' : 'Create a song, then attach its audios.'}
    onClose={onClose} busy={busy}>
    <form onSubmit={async event => {
      event.preventDefault()
      setBusy(true)
      setError('')
      try {
        const result = await api<Group>(group ? `/groups/${group.id}` : '/groups', {
          method: group ? 'PATCH' : 'POST', body: JSON.stringify({ name, color }),
        })
        onSaved(result)
        onClose()
      } catch (error) { setError(message(error)) } finally { setBusy(false) }
    }}>
      <label className="field">Song name<input autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)}
        placeholder="e.g. Midnight Drive" disabled={busy} /></label>
      {!group && <fieldset className="color-picker"><legend>Pick a color</legend>{GROUP_COLORS.map(item =>
        <button key={item} className={item === color ? 'selected' : ''} type="button" aria-label={`Color ${item}`}
          aria-pressed={color === item} style={{ backgroundColor: item }} onClick={() => setColor(item)}>
          {item === color && <Check size={18} />}
        </button>)}</fieldset>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy || !name.trim()}>{busy && <LoaderCircle className="spin" size={16} />}
          {group ? 'Save name' : 'Create song'}</button></div>
    </form>
  </Modal>
}
