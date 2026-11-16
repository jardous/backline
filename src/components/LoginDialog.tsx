import { useState } from 'react'
import { KeyRound, LoaderCircle } from 'lucide-react'
import Modal from './Modal'
import { api, message } from '../lib'

export interface Auth {
  authenticated: boolean
  configured: boolean
}

export default function LoginDialog({ configured, onClose, onLogin }: {
  configured: boolean; onClose: () => void; onLogin: (auth: Auth) => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="The keys to the room." description="Sign in as the owner to manage songs, audios, notes, and shared loops." onClose={onClose} busy={busy}>
    {!configured ? <div className="setup-notice"><KeyRound size={22} /><p>Owner access hasn’t been set up yet.</p>
      <p className="muted">Set <code>OWNER_PASSWORD</code> to a password of at least 12 characters in the server’s <code>.env</code> file, then restart the app.</p></div> :
      <form onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
          const auth = await api<Auth>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
          onLogin(auth)
          onClose()
        } catch (error) { setError(message(error)) } finally { setBusy(false) }
      }}>
        <label className="field">Owner password<input type="password" autoFocus autoComplete="current-password" required
          maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={busy || !password}>{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}Sign in</button></div>
      </form>}
  </Modal>
}
