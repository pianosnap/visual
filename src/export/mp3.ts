import { Mp3Encoder } from '@breezystack/lamejs'

// Encode an AudioBuffer to CBR MP3 via lamejs (pure JS — no codec/WebCodecs, works
// in every browser). MP3 is ~1/9th the size of WAV and, like WAV, is a legacy audio
// type macOS Gatekeeper does NOT flag on download (unlike MP4-container .m4a).
//
// This module statically imports lamejs (~tens of kB); app.ts dynamic-imports it so
// the encoder only loads when the user actually picks MP3 — it stays out of the
// initial bundle, matching how VideoExporter/Mediabunny are loaded.

const KBPS = 192 // good-quality CBR for music; ~1.4 MB/min vs WAV's ~10 MB/min
const BLOCK = 1152 // lamejs encodes in 1152-sample frames

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export function audioBufferToMp3(buffer: AudioBuffer): Uint8Array {
  const channels = Math.min(2, buffer.numberOfChannels) // lamejs: mono or stereo
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, KBPS)
  const left = floatToInt16(buffer.getChannelData(0))
  const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : undefined

  const chunks: Uint8Array[] = []
  for (let i = 0; i < left.length; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK)
    const chunk = right
      ? encoder.encodeBuffer(l, right.subarray(i, i + BLOCK))
      : encoder.encodeBuffer(l)
    if (chunk.length > 0) chunks.push(chunk)
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)

  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
