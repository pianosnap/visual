import { describe, expect, it } from 'vitest'
import { audioBufferToMp3 } from './mp3'

// jsdom has no AudioBuffer; duck-type the surface audioBufferToMp3 uses.
function fakeBuffer(channels: number[][], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]?.length ?? 0,
    getChannelData: (c: number) => Float32Array.from(channels[c] ?? []),
  } as unknown as AudioBuffer
}

// A 0.1s sine so the encoder has real signal to compress.
function sine(seconds: number, sampleRate = 44100, freq = 440): number[] {
  const n = Math.floor(seconds * sampleRate)
  return Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5)
}

describe('audioBufferToMp3', () => {
  it('produces a non-empty MP3 with a valid frame sync header (mono)', () => {
    const mp3 = audioBufferToMp3(fakeBuffer([sine(0.1)]))
    expect(mp3.byteLength).toBeGreaterThan(100)
    // MP3 frame sync: 11 set bits → byte0 === 0xFF and top 3 bits of byte1 set.
    expect(mp3[0]).toBe(0xff)
    expect(mp3[1]! & 0xe0).toBe(0xe0)
  })

  it('encodes stereo input', () => {
    const mp3 = audioBufferToMp3(fakeBuffer([sine(0.1, 44100, 440), sine(0.1, 44100, 660)]))
    expect(mp3.byteLength).toBeGreaterThan(100)
    expect(mp3[0]).toBe(0xff)
  })

  it('is far smaller than the equivalent WAV (compression sanity)', () => {
    const frames = 44100 // 1s mono
    const mp3 = audioBufferToMp3(fakeBuffer([sine(1)]))
    const wavBytes = 44 + frames * 2 // mono 16-bit WAV size
    expect(mp3.byteLength).toBeLessThan(wavBytes / 2)
  })
})
