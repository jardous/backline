export interface LoopPreference {
  start: number
  end: number
  repeat: boolean
}

interface StoredLoop extends LoopPreference {
  audioId: string
}

export const LOOP_COOKIE_NAME = 'backline_loop_ranges'
export const MAX_REMEMBERED_AUDIOS = 32
export const MAX_LOOP_COOKIE_LENGTH = 3500
const MAX_AUDIO_SECONDS = 172800
const MIN_LOOP_SECONDS = .1
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60

function validPreference(value: LoopPreference) {
  return Number.isFinite(value.start) && Number.isFinite(value.end)
    && value.start >= 0 && value.end <= MAX_AUDIO_SECONDS
    && value.end - value.start >= MIN_LOOP_SECONDS - 1e-6
    && typeof value.repeat === 'boolean'
}

export function decodeLoopCookie(encoded: string): StoredLoop[] {
  try {
    if (!encoded || encoded.length > MAX_LOOP_COOKIE_LENGTH) return []
    const data = JSON.parse(decodeURIComponent(encoded))
    if (data?.v !== 1 || !Array.isArray(data.items)) return []
    const result: StoredLoop[] = []
    const seen = new Set<string>()
    for (const item of data.items.slice(0, MAX_REMEMBERED_AUDIOS)) {
      if (!Array.isArray(item) || item.length !== 4) continue
      const [audioId, start, end, repeat] = item
      if (typeof audioId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(audioId) || seen.has(audioId)) continue
      const preference = { audioId, start, end, repeat }
      if (!validPreference(preference)) continue
      seen.add(audioId)
      result.push(preference)
    }
    return result
  } catch { return [] }
}

export function updateLoopCookie(previous: string, audioId: string, value: LoopPreference): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(audioId) || !validPreference(value)) return previous
  const preference = {
    audioId,
    start: Math.round(value.start * 1000) / 1000,
    end: Math.round(value.end * 1000) / 1000,
    repeat: value.repeat,
  }
  const items = [preference, ...decodeLoopCookie(previous).filter(item => item.audioId !== audioId)]
    .slice(0, MAX_REMEMBERED_AUDIOS)
  const encode = () => encodeURIComponent(JSON.stringify({
    v: 1,
    items: items.map(item => [item.audioId, item.start, item.end, item.repeat]),
  }))
  let encoded = encode()
  // One bounded cookie avoids per-audio cookie limits and oversized request headers.
  while (encoded.length > MAX_LOOP_COOKIE_LENGTH && items.length > 1) {
    items.pop()
    encoded = encode()
  }
  return encoded
}

export function clampLoopPreference(value: LoopPreference | null, duration: number): LoopPreference | null {
  if (!value || !validPreference(value) || !Number.isFinite(duration) || duration < MIN_LOOP_SECONDS) return null
  const end = Math.min(value.end, duration)
  if (end - value.start < MIN_LOOP_SECONDS - 1e-6) return null
  return { start: value.start, end, repeat: value.repeat }
}

function currentCookie() {
  return document.cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${LOOP_COOKIE_NAME}=`))?.slice(LOOP_COOKIE_NAME.length + 1) || ''
}

export function readLoopPreference(audioId: string): LoopPreference | null {
  try {
    const stored = decodeLoopCookie(currentCookie()).find(item => item.audioId === audioId)
    return stored ? { start: stored.start, end: stored.end, repeat: stored.repeat } : null
  } catch { return null } // Disabled cookies must never prevent playback.
}

export function writeLoopPreference(audioId: string, value: LoopPreference) {
  try {
    const encoded = updateLoopCookie(currentCookie(), audioId, value)
    if (!encoded) return
    document.cookie = `${LOOP_COOKIE_NAME}=${encoded}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  } catch { /* Playback still works if the browser blocks preference cookies. */ }
}
