import { Container, Graphics } from 'pixi.js'
import { GlowFilter } from 'pixi-filters'
import type { MidiTrack } from '../core/midi/types'
import { createNoteMaterial } from './createNoteMaterial'
import type { NoteMaterial, NoteMaterialId } from './NoteMaterial'
import { NoteLabelLayer } from './noteLabels'
import { getTrackColor, type Theme } from './theme'
import { type Viewport, visibleNoteRange } from './viewport'

// One Graphics object per track — same-color draws are batched together.
// A separate glow container holds only the notes currently being struck,
// so the expensive GlowFilter only runs over a small subset each frame.

const PRACTICE_INACTIVE_ALPHA_SCALE = 0.24

export class NoteRenderer {
  readonly container: Container

  private trackGraphics = new Map<string, Graphics>()
  private glowContainer: Container
  private glowGraphics: Graphics
  private glowFilter: GlowFilter
  // Pitch-class labels ("E", "F♯") on the bars — opt-in, sits above the glow
  // so the filter never blooms the text.
  private labels = new NoteLabelLayer()
  private material: NoteMaterial | null = null
  private materialId: NoteMaterialId | undefined
  private materialClip = new Graphics()
  private clipWidth = 0
  private clipHeight = 0
  private ledGlow = 1.0

  constructor(private theme: Theme) {
    this.container = new Container()
    this.container.label = 'notes'
    this.materialClip.label = 'note-consumption-clip'
    this.materialClip.visible = false
    this.container.addChild(this.materialClip)

    this.glowContainer = new Container()
    this.glowContainer.label = 'note-glow'

    this.glowFilter = new GlowFilter({
      distance: Math.max(4, Math.round(theme.noteGlowDistance * 0.7)),
      outerStrength: Math.min(theme.noteGlowStrength * 0.4, 2.0),
      innerStrength: theme.noteGlowStrength * 1.5,
      color: 0xffffff,
      quality: 0.3,
    })
    this.glowContainer.filters = [this.glowFilter]

    this.glowGraphics = new Graphics()
    this.glowContainer.addChild(this.glowGraphics)
    this.container.addChild(this.glowContainer)
    this.container.addChild(this.labels.container)
    this.updateTheme(theme)
  }

  setLedGlow(intensity: number): void {
    this.ledGlow = Math.max(0, intensity)
    if (this.glowFilter) {
      this.glowFilter.innerStrength = this.theme.noteGlowStrength * this.ledGlow * 1.5
      this.glowFilter.outerStrength = Math.min(this.theme.noteGlowStrength * this.ledGlow * 0.4, 2.5)
    }
  }

  setLabelsEnabled(on: boolean): void {
    this.labels.setEnabled(on)
  }

  // Call once when tracks are loaded — sets up one Graphics per track
  setTracks(tracks: MidiTrack[]): void {
    // Remove stale graphics
    const incomingIds = new Set(tracks.map((t) => t.id))
    for (const [id, g] of this.trackGraphics) {
      if (!incomingIds.has(id)) {
        this.container.removeChild(g)
        g.destroy()
        this.trackGraphics.delete(id)
      }
    }

    for (const track of tracks) {
      if (!this.trackGraphics.has(track.id)) {
        const g = new Graphics()
        g.label = `notes-${track.id}`
        // Insert before the glow container so glow renders on top.
        this.container.addChildAt(g, this.container.children.indexOf(this.glowContainer))
        this.trackGraphics.set(track.id, g)
      }
    }
  }

  // Called every frame from the main render loop.
  // Draws base notes and active-note glow in a single pass; accumulates the
  // glow-filter tint inline so no intermediate array is allocated per frame.
  draw(
    tracks: MidiTrack[],
    currentTime: number,
    viewport: Viewport,
    visibleTrackIds: Set<string>,
    practiceFocusTrackIds: ReadonlySet<string> | null,
  ): void {
    const { noteRadius } = this.theme
    const nowLineY = viewport.nowLineY
    this.glowGraphics.clear()
    if (
      this.material &&
      (this.clipWidth !== viewport.config.canvasWidth || this.clipHeight !== nowLineY)
    ) {
      this.clipWidth = viewport.config.canvasWidth
      this.clipHeight = nowLineY
      this.materialClip.clear().rect(0, 0, this.clipWidth, this.clipHeight).fill(0xffffff)
    }
    this.material?.setViewport?.(viewport.config.canvasWidth, viewport.rollHeight)
    this.material?.begin()
    const labels = this.labels.isActive ? this.labels : null
    labels?.begin()

    let activeCount = 0
    let sumR = 0,
      sumG = 0,
      sumB = 0

    const visStart = currentTime - viewport.trailSeconds - 0.5
    const visEnd = currentTime + viewport.lookaheadSeconds + 0.5

    for (const track of tracks) {
      const g = this.trackGraphics.get(track.id)
      if (!g) continue

      g.clear()

      if (!visibleTrackIds.has(track.id)) continue

      const noteColor = getTrackColor(track, this.theme)
      const practiceInactive =
        practiceFocusTrackIds !== null && !practiceFocusTrackIds.has(track.id)
      const colorR = (noteColor >> 16) & 0xff
      const colorG = (noteColor >> 8) & 0xff
      const colorB = noteColor & 0xff

      const [lo, hi] = visibleNoteRange(track.notes, visStart, visEnd)
      for (let ni = lo; ni < hi; ni++) {
        const note = track.notes[ni]!
        // No key under this pitch (off the 88 keys, or a narrowed viewport) —
        // skip rather than paint a zero-width bar at x = 0.
        if (!viewport.hasKey(note.pitch)) continue

        const x = viewport.pitchToX(note.pitch)
        const w = Math.max(viewport.pitchWidth(note.pitch) - 1, 2)
        const timeDelta = note.time - currentTime
        const noteBottom = Math.min(viewport.timeOffsetToY(timeDelta), nowLineY)
        const noteTop = viewport.timeOffsetToY(timeDelta + note.duration)
        if (noteTop >= nowLineY) continue
        const h = Math.max(noteBottom - noteTop, 3)
        const y = noteTop

        // Velocity → alpha (0.5 minimum so faint notes are still visible)
        const alpha =
          (0.5 + note.velocity * 0.5) * (practiceInactive ? PRACTICE_INACTIVE_ALPHA_SCALE : 1)

        const active =
          !practiceInactive && note.time <= currentTime && note.time + note.duration > currentTime
        if (this.material) {
          this.material.place(
            x,
            y,
            w,
            // Preserve the complete material coordinate system as the note
            // crosses the keys. One shared roll mask consumes the surface;
            // shrinking it here would squeeze every texture and reflection.
            Math.max(note.duration * viewport.config.pixelsPerSecond, 3),
            noteColor,
            alpha,
            currentTime,
            note.time,
            note.pitch + note.time,
            active,
          )
        } else {
          g.roundRect(x, y, w, h, noteRadius)
          g.fill({ color: noteColor, alpha })

          // Internal LED core illumination inside the note bar
          if (this.ledGlow > 0.05 && w >= 3 && h >= 4) {
            const led = Math.min(this.ledGlow, 2.5)
            const spineW = Math.max(1, Math.round(w * 0.44))
            const spineX = x + Math.round((w - spineW) / 2)
            const spineY = y + 2
            const spineH = Math.max(1, h - 4)
            const spineRadius = Math.max(1, noteRadius - 2)

            // Inner translucent LED core
            g.roundRect(spineX, spineY, spineW, spineH, spineRadius)
            g.fill({ color: 0xffffff, alpha: alpha * 0.28 * led })
            g.roundRect(spineX, spineY, spineW, spineH, spineRadius)
            g.fill({ color: noteColor, alpha: alpha * 0.38 * led })

            // Center high-intensity diode filament for wider bars
            if (spineW >= 3 && spineH >= 6) {
              const beamW = Math.max(1, Math.min(2, Math.round(w * 0.16)))
              const beamX = x + Math.round((w - beamW) / 2)
              g.rect(beamX, spineY + 2, beamW, Math.max(1, spineH - 4))
              g.fill({ color: 0xffffff, alpha: alpha * 0.48 * led })
            }
          }
        }

        labels?.place(note.pitch, x, w, noteBottom, h, noteColor, alpha)

        if (
          !this.material &&
          !practiceInactive &&
          note.time <= currentTime &&
          note.time + note.duration >= currentTime
        ) {
          const led = Math.min(this.ledGlow, 2.5)
          this.glowGraphics.roundRect(x, y, w, h, noteRadius)
          this.glowGraphics.fill({ color: noteColor, alpha: 0.9 })

          // Intense internal LED hot spot at the contact edge where the note strikes the key
          if (led > 0.05) {
            const hotH = Math.min(8, h)
            const hotY = Math.max(y, nowLineY - hotH)
            this.glowGraphics.roundRect(x + 1, hotY, Math.max(1, w - 2), hotH, 2)
            this.glowGraphics.fill({ color: 0xffffff, alpha: 0.65 * led })
          }

          sumR += colorR
          sumG += colorG
          sumB += colorB
          activeCount++
        }
      }
    }

    labels?.end()
    this.material?.end()

    if (activeCount > 0) {
      const avgColor =
        (Math.round(sumR / activeCount) << 16) |
        (Math.round(sumG / activeCount) << 8) |
        Math.round(sumB / activeCount)
      this.glowFilter.color = avgColor
      this.glowContainer.visible = true
    } else {
      this.glowContainer.visible = false
    }
  }

  updateTheme(theme: Theme): void {
    this.theme = theme
    if (theme.noteMaterial !== this.materialId) {
      this.material?.destroy()
      this.materialId = theme.noteMaterial
      this.material = theme.noteMaterial ? createNoteMaterial(theme.noteMaterial) : null
      if (this.material) {
        this.material.container.mask = this.materialClip
        this.container.addChildAt(
          this.material.container,
          this.container.children.indexOf(this.glowContainer),
        )
      }
      this.materialClip.visible = this.material !== null
    }
    // WebGL bakes distance into the shader; assigning the uniform alone only
    // changes padding. Recreate on radius changes so theme switching is real.
    const innerStr = theme.noteGlowStrength * this.ledGlow * 1.5
    const outerStr = Math.min(theme.noteGlowStrength * this.ledGlow * 0.4, 2.5)
    if (this.glowFilter.distance !== theme.noteGlowDistance) {
      this.glowFilter.destroy()
      this.glowFilter = new GlowFilter({
        distance: theme.noteGlowDistance,
        outerStrength: outerStr,
        innerStrength: innerStr,
        quality: 0.3,
      })
      this.glowContainer.filters = [this.glowFilter]
    }
    this.glowFilter.innerStrength = innerStr
    this.glowFilter.outerStrength = outerStr
  }

  clear(): void {
    this.trackGraphics.forEach((g) => {
      g.clear()
    })
    this.glowGraphics.clear()
    this.glowContainer.visible = false
    this.labels.clear()
    this.material?.clear()
  }

  destroy(): void {
    this.material?.destroy()
    this.glowFilter.destroy()
    this.container.destroy({ children: true })
  }
}
