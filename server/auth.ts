import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Express, Request, RequestHandler } from 'express'

const SESSION_AGE = 7 * 24 * 60 * 60 * 1000
const COOKIE = 'backline_owner'

export function setupAuth(app: Express, password: string | undefined) {
  if (password && password.length < 12) throw new Error('OWNER_PASSWORD must be at least 12 characters.')
  const salt = randomBytes(32)
  const passwordHash = password ? scryptSync(password, salt, 64) : null
  const sessions = new Map<string, number>()
  const attempts = new Map<string, { count: number; reset: number }>()
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const token = (req: Request) => {
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))
    return cookie?.slice(COOKIE.length + 1)
  }
  const authenticated = (req: Request) => {
    const value = token(req)
    if (!value) return false
    const key = hash(value)
    const expires = sessions.get(key)
    if (!expires) return false
    if (expires <= Date.now()) { sessions.delete(key); return false }
    return true
  }
  const cookieOptions = (req: Request) => ({
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: req.secure || process.env.COOKIE_SECURE === 'true',
    path: '/',
  })

  app.get('/api/auth/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ authenticated: authenticated(req), configured: !!passwordHash })
  })
  app.post('/api/auth/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!passwordHash) {
      res.status(503).json({ error: 'Owner access is not configured. Set OWNER_PASSWORD on the server and restart it.' })
      return
    }
    const now = Date.now()
    for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key)
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key)
    const ip = req.ip || 'unknown'
    const attempt = attempts.get(ip) || { count: 0, reset: now + 15 * 60 * 1000 }
    if (attempt.count >= 10 || attempts.size > 10_000) {
      res.setHeader('Retry-After', String(Math.ceil((attempt.reset - now) / 1000)))
      res.status(429).json({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' })
      return
    }
    attempt.count++
    attempts.set(ip, attempt)
    const input = req.body?.password
    if (typeof input !== 'string' || input.length > 1024 || !timingSafeEqual(scryptSync(input, salt, 64), passwordHash)) {
      res.status(401).json({ error: 'That password isn’t right. Please try again.' })
      return
    }
    attempts.delete(ip)
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!)
    const session = randomBytes(32).toString('hex')
    sessions.set(hash(session), now + SESSION_AGE)
    res.cookie(COOKIE, session, { ...cookieOptions(req), maxAge: SESSION_AGE })
    res.json({ authenticated: true, configured: true })
  })
  app.post('/api/auth/logout', (req, res) => {
    const value = token(req)
    if (value) sessions.delete(hash(value))
    res.clearCookie(COOKIE, cookieOptions(req))
    res.status(204).end()
  })

  const protectWrites: RequestHandler = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return }
    if (!authenticated(req)) {
      res.status(401).json({ error: 'Owner sign-in is required to change the shared library.' })
      return
    }
    next()
  }
  app.use('/api', protectWrites)
}
