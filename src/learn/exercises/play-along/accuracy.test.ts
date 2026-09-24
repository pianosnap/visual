import { describe, expect, it } from 'vitest'
import type { PlayAlongEngine } from './engine'
import { playAlongAccuracy } from './hud'

// playAlongAccuracy only reads engine.state.{perfect,good,errors}; a minimal
// stub exercises the pure scoring math (the value the collapsed chip shows).
function stub(perfect: number, good: number, errors: number): PlayAlongEngine {
  return { state: { perfect, good, errors } } as unknown as PlayAlongEngine
}

describe('playAlongAccuracy', () => {
  it('is 100 before anything is attempted (no divide-by-zero)', () => {
    expect(playAlongAccuracy(stub(0, 0, 0))).toBe(100)
  })

  it('counts both perfect and good as hits', () => {
    // hits 4 / attempts 4 → 100
    expect(playAlongAccuracy(stub(3, 1, 0))).toBe(100)
  })

  it('drops with errors: hits / (hits + errors)', () => {
    // hits 9 / attempts 10 → 90
    expect(playAlongAccuracy(stub(6, 3, 1))).toBe(90)
  })

  it('rounds to the nearest whole percent', () => {
    // hits 2 / attempts 3 → 66.66 → 67
    expect(playAlongAccuracy(stub(2, 0, 1))).toBe(67)
  })

  it('is 0 when every attempt was an error', () => {
    expect(playAlongAccuracy(stub(0, 0, 5))).toBe(0)
  })
})
