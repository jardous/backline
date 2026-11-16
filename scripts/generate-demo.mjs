// A small original, synthesized 100 BPM groove. No third-party recordings.
import { writeFileSync, mkdirSync } from 'node:fs'

const rate = 22050
const beat = 60 / 100
const duration = beat * 32
const samples = Math.ceil(rate * duration)
const audio = new Float32Array(samples)
let randomState = 42
const noise = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0
  return randomState / 4294967296 * 2 - 1
}
for (let step = 0; step < 64; step++) {
  const offset = step * beat / 2
  // Hats.
  for (let i = 0; i < rate * .065; i++) {
    const index = Math.floor(offset * rate) + i
    if (index < samples) audio[index] += noise() * Math.exp(-i / (rate * .013)) * (step % 2 ? .07 : .11)
  }
  if (step % 8 === 0 || step % 8 === 4 || step % 16 === 11) {
    for (let i = 0; i < rate * .3; i++) {
      const t = i / rate
      const index = Math.floor(offset * rate) + i
      if (index < samples) audio[index] += Math.sin(2 * Math.PI * (48 * t + 3.3 * (1 - Math.exp(-t * 25)))) * Math.exp(-t * 17) * .6
    }
  }
  if (step % 8 === 2 || step % 8 === 6) {
    for (let i = 0; i < rate * .18; i++) {
      const t = i / rate
      const index = Math.floor(offset * rate) + i
      if (index < samples) audio[index] += (noise() * .21 + Math.sin(2 * Math.PI * 185 * t) * .12) * Math.exp(-t * 24)
    }
  }
}
const progression = [55, 65.406, 48.999, 73.416]
for (let b = 0; b < 32; b++) {
  const f = progression[Math.floor(b / 8)]
  const offset = b * beat + (b % 4 === 3 ? beat / 2 : 0)
  for (let i = 0; i < rate * beat * .75; i++) {
    const t = i / rate
    const index = Math.floor(offset * rate) + i
    if (index < samples) audio[index] += (Math.sin(2 * Math.PI * f * t) + .15 * Math.sin(2 * Math.PI * f * 2 * t)) * Math.exp(-t * 5) * Math.min(t * 80, 1) * .25
  }
}
const buffer = Buffer.alloc(44 + samples * 2)
buffer.write('RIFF', 0)
buffer.writeUInt32LE(buffer.length - 8, 4)
buffer.write('WAVEfmt ', 8)
buffer.writeUInt32LE(16, 16)
buffer.writeUInt16LE(1, 20)
buffer.writeUInt16LE(1, 22)
buffer.writeUInt32LE(rate, 24)
buffer.writeUInt32LE(rate * 2, 28)
buffer.writeUInt16LE(2, 32)
buffer.writeUInt16LE(16, 34)
buffer.write('data', 36)
buffer.writeUInt32LE(samples * 2, 40)
for (let i = 0; i < samples; i++) {
  const fade = Math.min(1, (samples - i) / (rate * .035))
  buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio[i] * fade)) * 32767), 44 + i * 2)
}
mkdirSync('public', { recursive: true })
writeFileSync('public/demo.wav', buffer)
console.log('Created public/demo.wav (19.2-second original demo groove).')
