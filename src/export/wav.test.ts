import { describe, expect, it } from 'vitest'
import { audioBufferToWav } from './wav'

// jsdom has no AudioBuffer; duck-type the surface audioBufferToWav uses.
function fakeBuffer(channels: number[][], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]?.length ?? 0,
    getChannelData: (c: number) => Float32Array.from(channels[c] ?? []),
  } as unknown as AudioBuffer
}

const str = (b: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...b.subarray(off, off + len))
const u32 = (b: Uint8Array, off: number) => new DataView(b.buffer).getUint32(off, true)
const u16 = (b: Uint8Array, off: number) => new DataView(b.buffer).getUint16(off, true)
const i16 = (b: Uint8Array, off: number) => new DataView(b.buffer).getInt16(off, true)

describe('audioBufferToWav', () => {
  it('writes a valid RIFF/WAVE/fmt/data header for mono', () => {
    const wav = audioBufferToWav(fakeBuffer([[0, 0, 0]], 48000))
    expect(str(wav, 0, 4)).toBe('RIFF')
    expect(str(wav, 8, 4)).toBe('WAVE')
    expect(str(wav, 12, 4)).toBe('fmt ')
    expect(str(wav, 36, 4)).toBe('data')
    expect(u32(wav, 16)).toBe(16) // PCM fmt length
    expect(u16(wav, 20)).toBe(1) // PCM
    expect(u16(wav, 22)).toBe(1) // mono
    expect(u32(wav, 24)).toBe(48000) // sample rate
    expect(u16(wav, 34)).toBe(16) // bits per sample
  })

  it('computes sizes/blockAlign/byteRate for stereo', () => {
    const frames = 5
    const wav = audioBufferToWav(fakeBuffer([new Array(frames).fill(0), new Array(frames).fill(0)]))
    const blockAlign = 2 /*ch*/ * 2 /*bytes*/
    const dataSize = frames * blockAlign
    expect(wav.byteLength).toBe(44 + dataSize)
    expect(u16(wav, 32)).toBe(blockAlign)
    expect(u32(wav, 28)).toBe(44100 * blockAlign) // byte rate
    expect(u32(wav, 40)).toBe(dataSize) // data chunk size
    expect(u32(wav, 4)).toBe(36 + dataSize) // RIFF size
  })

  it('scales float samples to int16 and clamps out-of-range', () => {
    // 0 → 0, +1 → +32767, -1 → -32768, and >1 / <-1 clamp to the same.
    const wav = audioBufferToWav(fakeBuffer([[0, 1, -1, 2, -2]]))
    expect(i16(wav, 44)).toBe(0)
    expect(i16(wav, 46)).toBe(32767)
    expect(i16(wav, 48)).toBe(-32768)
    expect(i16(wav, 50)).toBe(32767) // 2 clamped to +1
    expect(i16(wav, 52)).toBe(-32768) // -2 clamped to -1
  })

  it('interleaves channels frame-by-frame (L,R,L,R…)', () => {
    // L = [1, 0], R = [-1, 0] → int16 stream: 32767, -32768, 0, 0
    const wav = audioBufferToWav(
      fakeBuffer([
        [1, 0],
        [-1, 0],
      ]),
    )
    expect(i16(wav, 44)).toBe(32767) // frame0 L
    expect(i16(wav, 46)).toBe(-32768) // frame0 R
    expect(i16(wav, 48)).toBe(0) // frame1 L
    expect(i16(wav, 50)).toBe(0) // frame1 R
  })
})
