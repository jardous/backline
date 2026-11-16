import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, description, children, onClose, busy = false, wide = false }: {
  title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="modal-content">
      <button className="icon-button modal-close" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20} /></button>
      <h2>{title}</h2>
      {description && <p className="muted modal-description">{description}</p>}
      {children}
    </div>
  </dialog>
}
