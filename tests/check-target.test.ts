import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

for (const script of ['scripts/check-deployment.mjs', 'scripts/check-live-browser.mjs']) {
  test(`${script} requires an explicit HTTPS target before reading credentials or making requests`, () => {
    const env = { ...process.env, BACKLINE_URL: '' }
    const missing = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /Pass your HTTPS instance URL/)
    const insecure = spawnSync(process.execPath, [script, 'http://localhost:3001'], { env, encoding: 'utf8' })
    assert.equal(insecure.status, 1)
    assert.match(insecure.stderr, /Use an HTTPS instance URL without embedded credentials/)
    const credentials = spawnSync(process.execPath, [script, 'https://user:example-password@example.com'], { env, encoding: 'utf8' })
    assert.equal(credentials.status, 1)
    assert.match(credentials.stderr, /Use an HTTPS instance URL without embedded credentials/)
  })
}
