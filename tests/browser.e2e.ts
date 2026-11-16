import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { createApp } from '../server/app.js'
import { decodeLoopCookie, LOOP_COOKIE_NAME, MAX_LOOP_COOKIE_LENGTH } from '../src/loopCookies.js'

const directory = await mkdtemp('/tmp/opencode/backline-browser-')
const artifacts = '/tmp/opencode/backline-screenshots'
await mkdir(artifacts, { recursive: true })
const password = 'browser-test-owner-passphrase'
const { app, store } = createApp(directory, resolve('dist'), password)
const server = app.listen(0, '127.0.0.1')
await new Promise<void>(resolve => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const errors: string[] = []
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
const createSong = async (name: string) => {
  await page.getByRole('button', { name: 'New song', exact: true }).first().click()
  await page.getByLabel('Song name', { exact: true }).fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Create song', exact: true }).click()
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
const attachAudio = async (name: string, notes = '') => {
  await page.getByRole('button', { name: 'Add audio', exact: true }).click()
  await page.getByLabel('Choose audio files').setInputFiles({ name, mimeType: 'audio/wav', buffer: await readFile('public/demo.wav') })
  await page.getByRole('dialog').getByLabel('Audio notes', { exact: false }).fill(notes)
  await page.getByRole('dialog').getByRole('button', { name: 'Upload audio', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.locator('.recording-row').filter({ hasText: name.replace('.wav', '') }).waitFor()
}
const setRange = async (page: Page, start: string, end: string) => {
  const startField = page.getByLabel('Loop start', { exact: true })
  const endField = page.getByLabel('Loop end', { exact: true })
  await startField.fill('0:00.0'); await startField.blur()
  await endField.fill(end); await endField.blur()
  await startField.fill(start); await startField.blur()
}

try {
  await page.goto(base)
  await page.getByRole('heading', { name: 'The practice room.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'New song', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Owner sign in', exact: true }).first().click()
  await page.getByLabel('Owner password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'New song', exact: true }).first().waitFor()
  await createSong('SONG1')
  await page.getByRole('heading', { name: 'Audios', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Audio versions', exact: true }).count(), 0)
  assert.equal(await page.locator('.recording-row').count(), 0)
  await page.getByRole('button', { name: 'Try with a demo', exact: true }).click()
  await page.getByRole('heading', { name: 'Pocket groove (demo)', exact: true }).waitFor()
  await page.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  const firstRecordingId = store.songs()[0].id
  const song1 = store.groups().find(item => item.name === 'SONG1')!
  console.log('✓ Owner creates a song first, then attaches its first playable audio')

  await setRange(page, '0:04.8', '0:09.6')
  await page.getByRole('button', { name: 'Save this loop', exact: true }).click()
  await page.getByLabel('Loop name').fill('Chorus transition')
  await page.getByRole('button', { name: 'Save shared loop', exact: true }).click()
  await page.locator('.saved-loop-main').filter({ hasText: 'Chorus transition' }).waitFor()
  await page.getByRole('button', { name: 'Edit notes', exact: true }).click()
  await page.getByLabel('Audio notes', { exact: true }).fill('Reference audio: come in together after the fill.')
  await page.getByRole('button', { name: 'Save notes', exact: true }).click()
  await page.locator('.song-notes').filter({ hasText: 'Reference audio:' }).waitFor()
  await page.getByRole('button', { name: 'Edit audio details', exact: true }).click()
  await page.getByLabel('Audio name', { exact: true }).fill('Reference audio')
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await page.getByRole('heading', { name: 'Reference audio', exact: true }).waitFor()

  await setRange(page, '0:01.0', '0:01.5')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const wraps = await page.evaluate<number>(`new Promise(resolve => {
    let last = 0, wraps = 0;
    const start = performance.now();
    const tick = () => {
      const text = document.querySelector('.playback-time strong')?.textContent || '0:00.0';
      const [minutes, seconds] = text.split(':').map(Number);
      const current = minutes * 60 + seconds;
      if (last - current > .15) wraps++;
      last = current;
      if (wraps >= 3 || performance.now() - start > 6000) resolve(wraps);
      else requestAnimationFrame(tick);
    };
    tick();
  })`)
  assert.ok(wraps >= 3)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByLabel('Playback speed').selectOption('0.75')
  await page.locator('.saved-loop-main').filter({ hasText: 'Chorus transition' }).click()
  await page.getByRole('button', { name: 'Share loop Chorus transition', exact: true }).click()
  const sharedLoop = await page.evaluate(() => navigator.clipboard.readText())
  assert.match(sharedLoop, /\?song=.+&recording=.+&loop=.+/)
  const loop = store.loops(firstRecordingId)[0]
  await page.screenshot({ path: `${artifacts}/01-version-player.png`, fullPage: true })
  console.log('✓ Audio notes, saved loops, repeated playback, speed, and audio/loop links')

  const box = (await page.getByTestId('waveform').boundingBox())!
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .85, box.y + box.height * .4, { steps: 15 })
  await page.mouse.up()
  await page.waitForFunction(() => Number((document.querySelector('[aria-label="Loop start"]') as HTMLInputElement).value.split(':')[1]) > 10)
  await page.getByRole('button', { name: 'Back to song', exact: true }).click()
  await page.getByRole('button', { name: 'Edit notes', exact: true }).click()
  await page.getByLabel('Song notes', { exact: true }).fill('Common song notes: intro, verse, chorus. Stay relaxed.')
  await page.getByRole('button', { name: 'Save notes', exact: true }).click()
  await page.locator('.song-notes').filter({ hasText: 'Common song notes:' }).waitFor()
  await attachAudio('Backing track.wav', 'Instrumental audio without vocals.')
  await attachAudio('Rehearsal take.wav', 'Another audio to organize.')
  assert.equal(await page.locator('.recording-row').count(), 3)
  await page.screenshot({ path: `${artifacts}/02-song-versions.png`, fullPage: true })
  await page.getByRole('button', { name: 'Share song', exact: true }).click()
  const sharedSong = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(new URL(sharedSong).searchParams.get('song'), song1.id)
  assert.equal(new URL(sharedSong).searchParams.has('recording'), false)
  await page.getByRole('button', { name: 'Back to library', exact: true }).click()
  assert.equal(await page.locator('.song-row').count(), 1)
  assert.equal(await page.locator('.recording-row').count(), 0)
  assert.equal(await page.locator('.song-table-heading > span').nth(1).innerText(), 'AUDIOS')
  assert.match(await page.locator('.version-count').innerText(), /3 audios/)
  await page.getByLabel('Search songs').fill('Instrumental audio')
  assert.equal(await page.locator('.song-row').count(), 1)
  assert.equal(await page.locator('.song-row strong').innerText(), 'SONG1')
  await page.getByLabel('Clear search').click()
  await page.screenshot({ path: `${artifacts}/03-song-library.png`, fullPage: true })
  console.log('✓ Library shows one song with audios; song notes and audio search work')

  await createSong('SONG2')
  const song2 = store.groups().find(item => item.name === 'SONG2')!
  await page.getByRole('button', { name: 'Back to library', exact: true }).click()
  await page.locator('.song-row').filter({ hasText: 'SONG1' }).click()
  await page.locator('.recording-row').filter({ hasText: 'Rehearsal take' }).click()
  await page.getByRole('button', { name: 'Edit audio details', exact: true }).click()
  await page.getByLabel('Song', { exact: true }).selectOption(song2.id)
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await page.getByRole('button', { name: 'Back to song', exact: true }).click()
  await page.getByRole('heading', { name: 'SONG2', exact: true }).waitFor()
  assert.equal(await page.locator('.recording-row').count(), 1)
  assert.equal(store.songs().filter(item => item.groupId === song1.id).length, 2)
  assert.equal(store.loops(firstRecordingId)[0].id, loop.id)
  console.log('✓ Audios can move between songs without losing notes, files, or saved loops')

  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobile = await visitor.newPage()
  mobile.on('pageerror', error => errors.push(error.message))
  await mobile.goto(sharedSong)
  await mobile.getByRole('heading', { name: 'SONG1', exact: true }).waitFor()
  assert.equal(await mobile.locator('.recording-row').count(), 2)
  assert.equal(await mobile.getByRole('button', { name: 'Add audio', exact: true }).count(), 0)
  assert.equal(await mobile.getByRole('button', { name: 'Edit notes', exact: true }).count(), 0)
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await mobile.screenshot({ path: `${artifacts}/04-mobile-song.png`, fullPage: true })
  await mobile.goto(sharedLoop)
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Loop start"]') as HTMLInputElement)?.value === '0:04.8')
  assert.equal(await mobile.getByRole('button', { name: 'Edit audio details', exact: true }).count(), 0)
  await setRange(mobile, '0:06.0', '0:08.0')
  assert.equal(store.loops(firstRecordingId)[0].start, 4.8)
  assert.equal((await mobile.request.patch(`${base}/api/groups/${song1.id}`, { data: { notes: 'Unauthorized' } })).status(), 401)
  // Navigate immediately: the unmount flush must persist even before the debounce.
  await mobile.getByRole('button', { name: 'Back to song', exact: true }).click()
  await mobile.locator('.recording-row').filter({ hasText: 'Reference audio' }).click()
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Loop start"]') as HTMLInputElement)?.value === '0:06.0')
  assert.equal(await mobile.getByLabel('Loop end', { exact: true }).inputValue(), '0:08.0')
  await mobile.getByRole('button', { name: 'Loop on', exact: true }).click()
  await mobile.reload()
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Loop start"]') as HTMLInputElement)?.value === '0:06.0')
  await mobile.getByRole('button', { name: 'Loop off', exact: true }).waitFor()
  const preferenceCookie = (await visitor.cookies()).find(cookie => cookie.name === LOOP_COOKIE_NAME)!
  assert.ok(preferenceCookie)
  assert.equal(preferenceCookie.sameSite, 'Lax')
  assert.ok(preferenceCookie.expires > Date.now() / 1000 + 300 * 24 * 60 * 60)
  assert.ok(preferenceCookie.value.length <= MAX_LOOP_COOKIE_LENGTH)
  assert.deepEqual(decodeLoopCookie(preferenceCookie.value).find(item => item.audioId === firstRecordingId),
    { audioId: firstRecordingId, start: 6, end: 8, repeat: false })
  const ownerCookie = (await context.cookies()).find(cookie => cookie.name === LOOP_COOKIE_NAME)!
  assert.notEqual(decodeLoopCookie(ownerCookie.value).find(item => item.audioId === firstRecordingId)?.start, 6)
  await mobile.getByRole('button', { name: 'Back to song', exact: true }).click()
  await mobile.locator('.recording-row').filter({ hasText: 'Backing track' }).click()
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  assert.equal(await mobile.getByLabel('Loop start', { exact: true }).inputValue(), '0:00.0')
  await setRange(mobile, '0:02.0', '0:05.0')
  await mobile.reload()
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Loop start"]') as HTMLInputElement)?.value === '0:02.0')
  assert.equal(await mobile.getByLabel('Loop end', { exact: true }).inputValue(), '0:05.0')
  await mobile.getByRole('button', { name: 'Back to song', exact: true }).click()
  await mobile.locator('.recording-row').filter({ hasText: 'Reference audio' }).click()
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Loop start"]') as HTMLInputElement)?.value === '0:06.0')
  await mobile.getByRole('button', { name: 'Loop off', exact: true }).waitFor()
  // Explicit links win over a different browser-local range for the same audio.
  await mobile.goto(`${base}/?song=${firstRecordingId}&loop=${loop.id}`)
  await mobile.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Loop start"]') as HTMLInputElement)?.value === '0:04.8')
  await mobile.getByRole('button', { name: 'Back to song', exact: true }).click()
  await mobile.getByRole('heading', { name: 'SONG1', exact: true }).waitFor()
  await visitor.close()
  console.log('✓ Cookie ranges persist through reload/navigation, remain per-audio/per-browser, and do not overwrite shared loops')

  const blockedCookies = await browser.newContext()
  await blockedCookies.addInitScript(`Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    get() { throw new DOMException('Cookies disabled', 'SecurityError'); },
    set() { throw new DOMException('Cookies disabled', 'SecurityError'); }
  });`)
  const blocked = await blockedCookies.newPage()
  blocked.on('pageerror', error => errors.push(error.message))
  await blocked.goto(`${base}/?song=${firstRecordingId}`)
  await blocked.waitForFunction(() => !(document.querySelector('.play-button') as HTMLButtonElement)?.disabled)
  await setRange(blocked, '0:02.0', '0:04.0')
  await blocked.getByRole('button', { name: 'Play', exact: true }).click()
  await blocked.getByRole('button', { name: 'Pause', exact: true }).waitFor()
  await blocked.getByRole('button', { name: 'Pause', exact: true }).click()
  await blockedCookies.close()
  console.log('✓ Playback still works when the browser blocks preference cookies')

  await page.locator('.recording-row').first().click()
  await page.getByRole('button', { name: 'Edit audio details', exact: true }).click()
  await page.getByRole('button', { name: 'Delete audio', exact: true }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('heading', { name: 'SONG2', exact: true }).waitFor()
  assert.equal(await page.locator('.recording-row').count(), 0)
  assert.ok(store.groups().some(item => item.id === song2.id))
  await page.getByRole('button', { name: 'Delete song', exact: true }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.locator('.song-row').filter({ hasText: 'SONG1' }).waitFor()
  await page.locator('.song-row').filter({ hasText: 'SONG1' }).click()
  await page.getByRole('button', { name: 'Rename song', exact: true }).click()
  await page.getByLabel('Song name', { exact: true }).fill('SONG1 renamed')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await page.getByRole('heading', { name: 'SONG1 renamed', exact: true }).waitFor()
  assert.equal(await page.locator('.recording-row').count(), 2)
  await page.getByRole('button', { name: 'Delete song', exact: true }).click()
  await page.getByText(/all 2 attached audios/).waitFor()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('heading', { name: 'Every great set starts with a song.' }).waitFor()
  assert.equal(store.songs().length, 0)
  assert.equal(store.groups().length, 0)
  assert.equal(store.loops(firstRecordingId).length, 0)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.reload()
  assert.equal(await page.getByRole('button', { name: 'New song', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(`✓ Audio deletion preserves its song; explicit song deletion removes all its audios. Screenshots: ${artifacts}`)
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true })
  throw error
} finally {
  await browser.close()
  await new Promise<void>(resolve => server.close(() => resolve()))
  store.db.close()
  await rm(directory, { recursive: true, force: true })
}
