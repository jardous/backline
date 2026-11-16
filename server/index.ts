import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createApp } from './app.js'

if (existsSync('.env')) process.loadEnvFile('.env')
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
const { app, store } = createApp(
  resolve(process.env.DATA_DIR || 'data'),
  resolve('dist'),
)
const server = app.listen(port, host, () => {
  console.log(`Backline is ready at http://localhost:${port}`)
  console.log('Bandmates can listen without signing in. Only the owner can edit the shared library.')
  if (!process.env.OWNER_PASSWORD) console.log('Set OWNER_PASSWORD (12+ characters) in .env to enable owner sign-in.')
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => {
      store.db.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 5000).unref()
  })
}
