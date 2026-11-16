import type { Song } from '../shared/types'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `Request failed (${response.status}).`)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function time(seconds: number, precise = false): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const value = precise ? Math.round(Math.max(0, seconds) * 10) / 10 : Math.max(0, seconds)
  const minutes = Math.floor(value / 60)
  const rest = Math.floor(value % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}${precise ? `.${Math.round(value * 10) % 10}` : ''}`
}

export function parseTime(value: string): number | null {
  const input = value.trim()
  if (!/^\d+(?::[0-5]?\d)?(?:\.\d{1,3})?$/.test(input)) return null
  const parts = input.split(':')
  const result = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0])
  return Number.isFinite(result) ? result : null
}

export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export async function copyLink(url: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(url)
    return
  }
  const field = document.createElement('textarea')
  field.value = url
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('Could not copy the link. Copy it from your address bar instead.')
}

export function songLink(song: Song, loopId?: string) {
  const url = new URL(window.location.href)
  url.search = ''
  if (song.groupId) url.searchParams.set('song', song.groupId)
  url.searchParams.set('recording', song.id)
  if (loopId) url.searchParams.set('loop', loopId)
  return url.href
}

export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const url = URL.createObjectURL(file)
    const cleanup = () => {
      clearTimeout(timeout)
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Could not read "${file.name}". Try converting it to MP3 or WAV.`))
    }, 25_000)
    audio.onloadedmetadata = () => {
      const duration = audio.duration
      if (Number.isFinite(duration) && duration > 0) {
        audio.onloadedmetadata = null
        audio.onerror = null
        cleanup()
        resolve(duration)
      } else {
        // Some WebM recordings omit the duration in their container.
        audio.currentTime = 1e10
        audio.ontimeupdate = () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            const value = audio.duration
            audio.ontimeupdate = null
            cleanup()
            resolve(value)
          }
        }
      }
    }
    audio.onerror = () => {
      audio.onerror = null
      cleanup()
      reject(new Error(`Your browser cannot play "${file.name}". MP3 and WAV work in most browsers.`))
    }
    audio.preload = 'metadata'
    audio.src = url
  })
}

export function uploadAudio(data: FormData, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<Song> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/songs')
    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100))
    }
    xhr.onloadend = () => signal?.removeEventListener('abort', abort)
    xhr.onload = () => {
      let result
      try { result = JSON.parse(xhr.responseText) } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result)
      else reject(new Error(result?.error || 'Upload failed. Please try again.'))
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))
    if (signal?.aborted) { reject(new Error('Upload cancelled.')); return }
    xhr.send(data)
  })
}
