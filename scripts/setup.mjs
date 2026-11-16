import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

if (existsSync('.env')) {
  console.log('.env already exists and was left unchanged.')
} else {
  writeFileSync('.env', [
    '# Generated locally. Keep this file private and out of version control.',
    '# You can change this password and restart the app at any time.',
    `OWNER_PASSWORD=${randomBytes(24).toString('base64url')}`,
    'PORT=3001',
    'HOST=0.0.0.0',
    'DATA_DIR=./data',
    '',
  ].join('\n'), { mode: 0o600, flag: 'wx' })
  console.log('Created .env with a strong, randomly generated owner password (file is readable only by you).')
}
console.log('View or change OWNER_PASSWORD in .env, then run npm run dev or npm start.')
