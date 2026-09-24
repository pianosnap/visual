// Encode an AudioBuffer to a 16-bit PCM WAV (RIFF, little-endian).
//
// Why WAV for the standalone audio export (instead of AAC-in-MP4 / .m4a):
//   • macOS Gatekeeper. Browser downloads always get the `com.apple.quarantine`
//     attribute; on macOS 15+ an MP4-container audio file (.m4a) it can't verify
//     triggers the scary "could not verify… malware → Move to Trash" dialog. WAV
//     is a legacy, unambiguously-recognized audio type that macOS does NOT gate,
//     so the export opens cleanly.
//   • No codec needed — pure JS PCM. Works in every browser (no WebCodecs/AAC
//     dependency), so audio export succeeds even where AudioEncoder is missing.
//
// Pure + DOM-free so it's unit-testable; the caller wraps the bytes in a Blob.

export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const bytesPerSample = 2 // 16-bit
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign

  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)

  const writeString = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  // RIFF / WAVE header
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // file size minus the 8-byte RIFF header
  writeString(8, 'WAVE')
  // fmt chunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk length
  view.setUint16(20, 1, true) // audio format 1 = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true) // bits per sample
  // data chunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Interleave channels and convert float [-1, 1] → signed 16-bit.
  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!))
      // Asymmetric scale: negative range is -32768, positive is +32767.
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }

  return new Uint8Array(out)
}
