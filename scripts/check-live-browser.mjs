import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { chromium } from 'playwright'

// Read-only against the library: signs in/out but never uploads or edits records.
const base = (process.argv[2] || process.env.BACKLINE_URL || '').replace(/\/+$/, '')
if (!base) throw new Error('Pass your HTTPS instance URL as the first argument, or set BACKLINE_URL.')
const target = new URL(base)
if (target.protocol !== 'https:' || target.username || target.password) {
  throw new Error('Use an HTTPS instance URL without embedded credentials.')
}
const password = process.env.OWNER_PASSWORD || parseEnv(readFileSync('.env', 'utf8')).OWNER_PASSWORD
const artifacts = await mkdtemp('/tmp/opencode/backline-live-')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
})
const errors = []
const LOOP_COOKIE_NAME = 'backline_loop_ranges'
const recordError = message => errors.push(message.replace(/data:[^'"\s]+/g, '[inline asset]'))
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', error => recordError(error.message))
  page.on('console', entry => { if (entry.type() === 'error') recordError(entry.text()) })
  await page.goto(base)
  await page.locator('.song-row').first().waitFor()
  const library = await (await page.request.get(`${base}/api/library`)).json()
  assert.equal(await page.locator('.song-row').count(), library.groups.length)
  assert.equal(await page.getByRole('button', { name: 'New song', exact: true }).count(), 0)
  await page.screenshot({ path: `${artifacts}/desktop-library.png`, fullPage: true })

  const populated = library.groups.find(song => library.songs.some(recording => recording.groupId === song.id))
  assert.ok(populated, 'A recording is required for the live playback check')
  await page.locator(`.song-row[data-song-id="${populated.id}"]`).click()
  await page.getByRole('heading', { name: 'Audios', exact: true }).waitFor()
  await page.locator('.recording-row').first().waitFor()
  await page.screenshot({ path: `${artifacts}/desktop-song.png`, fullPage: true })
  await page.locator('.recording-row').first().click()
  await page.waitForFunction(() => !document.querySelector('.play-button')?.disabled, {}, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.playback-time strong')?.textContent !== '0:00.0')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: 'Owner sign in', exact: true }).first().click()
  await page.getByLabel('Owner password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Edit audio details', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit notes', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Owner sign in', exact: true }).first().waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit notes', exact: true }).count(), 0)
  const currentAudio = library.songs.find(audio => audio.id === new URL(page.url()).searchParams.get('recording'))
  assert.ok(currentAudio && currentAudio.duration > 3, 'The cookie smoke test needs an audio longer than three seconds')
  await page.getByLabel('Loop start', { exact: true }).fill('0:00.0')
  await page.getByLabel('Loop start', { exact: true }).blur()
  await page.getByLabel('Loop end', { exact: true }).fill('0:03.0')
  await page.getByLabel('Loop end', { exact: true }).blur()
  await page.getByLabel('Loop start', { exact: true }).fill('0:01.0')
  await page.getByLabel('Loop start', { exact: true }).blur()
  await page.getByRole('button', { name: 'Loop on', exact: true }).click()
  await page.reload()
  await page.waitForFunction(() => !document.querySelector('.play-button')?.disabled, {}, { timeout: 60_000 })
  await page.waitForFunction(() => document.querySelector('[aria-label="Loop start"]')?.value === '0:01.0')
  assert.equal(await page.getByLabel('Loop end', { exact: true }).inputValue(), '0:03.0')
  await page.getByRole('button', { name: 'Loop off', exact: true }).waitFor()
  const cookie = (await context.cookies()).find(item => item.name === LOOP_COOKIE_NAME)
  assert.ok(cookie?.secure)
  assert.equal(cookie.sameSite, 'Lax')
  assert.ok(cookie.expires > Date.now() / 1000 + 300 * 24 * 60 * 60)
  assert.deepEqual(JSON.parse(decodeURIComponent(cookie.value)).items.find(item => item[0] === currentAudio.id),
    [currentAudio.id, 1, 3, false])
  await page.screenshot({ path: `${artifacts}/desktop-player.png`, fullPage: true })

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobilePage = await mobile.newPage()
  mobilePage.on('pageerror', error => recordError(error.message))
  mobilePage.on('console', entry => { if (entry.type() === 'error') recordError(entry.text()) })
  await mobilePage.goto(page.url())
  await mobilePage.waitForFunction(() => !document.querySelector('.play-button')?.disabled, {}, { timeout: 60_000 })
  assert.equal(await mobilePage.getByLabel('Loop start', { exact: true }).inputValue(), '0:00.0', 'Personal cookie ranges must not leak between browser contexts')
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await mobilePage.getByRole('button', { name: 'Play', exact: true }).click()
  await mobilePage.waitForFunction(() => document.querySelector('.playback-time strong')?.textContent !== '0:00.0')
  await mobilePage.getByRole('button', { name: 'Pause', exact: true }).click()
  await mobilePage.screenshot({ path: `${artifacts}/mobile-player.png`, fullPage: true })
  const recordingId = new URL(mobilePage.url()).searchParams.get('recording')
  assert.ok(recordingId)
  await mobilePage.goto(`${base}/?song=${recordingId}`)
  await mobilePage.waitForFunction(() => !document.querySelector('.play-button')?.disabled, {}, { timeout: 60_000 })
  await mobilePage.getByRole('button', { name: 'Back to song', exact: true }).click()
  await mobilePage.locator('.recording-row').first().waitFor()
  assert.equal(await mobilePage.locator('.recording-row').count(), library.songs.filter(recording => recording.groupId === populated.id).length)
  assert.equal(await mobilePage.getByRole('button', { name: 'Add audio', exact: true }).count(), 0)
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await mobilePage.screenshot({ path: `${artifacts}/mobile-song.png`, fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Live desktop and mobile checks passed: persistent Secure loop cookies, per-browser isolation, song/audio lists, old/new links, playback, owner permissions, no overflow or JavaScript/CSP errors.')
  console.log('Private verification screenshots:', artifacts)
} finally {
  await browser.close()
}
