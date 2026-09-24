import { createSignal, For } from 'solid-js'
import { render } from 'solid-js/web'
import type { MidiFile, MidiTrack } from '../core/midi/types'
import { t, tn } from '../i18n'
import type { PianoRollRenderer } from '../renderer/PianoRollRenderer'
import { getTrackColor, type Theme } from '../renderer/theme'
import { icons } from './icons'
import { hexToCSS, isNarrowViewport } from './utils'

// Popover dropdown anchored under the Tracks button in the top strip.
// Each track has a mute toggle; a "Load new file" footer reopens the Open
// MIDI modal for quick swap.

interface PanelProps {
  isOpen: () => boolean
  isSheet: () => boolean
  tracks: () => readonly MidiTrack[]
  theme: () => Theme
  renderer: PianoRollRenderer
  onTrackEnabledChange: (trackId: string, enabled: boolean) => void
  onTrackColorChange: (trackId: string, color: number) => void
  ledGlow: () => number
  onSetLedGlow: (val: number) => void
  // The rows are rebuilt whenever `tracks` changes identity — which now also
  // happens on a transpose re-derive, not just on a new file. Reading the
  // live mute state keeps the checkboxes from silently flipping back to "on"
  // while the synth is still muting the track.
  isTrackEnabled: (trackId: string) => boolean
  onLoadNew: () => void
  registerPanelEl: (el: HTMLElement) => void
}

function TrackPanelView(props: PanelProps) {
  return (
    <div
      id="track-panel"
      class="ts-popover"
      classList={{
        'ts-popover--open': props.isOpen(),
        'popover--sheet': props.isSheet(),
      }}
      ref={(el) => props.registerPanelEl(el)}
    >
      <div class="panel-header">
        <span class="panel-label">{t('tracks.title')}</span>
      </div>

      <div class="panel-led-control">
        <div class="panel-led-head">
          <span class="panel-led-title">
            <span innerHTML={icons.sparkles(12)} style={{ display: 'inline-flex', 'vertical-align': 'middle', 'margin-right': '4px' }} />
            {t('tracks.ledGlow') || 'Luminosità LED & Glow'}
          </span>
          <span class="panel-led-val">{Math.round(props.ledGlow() * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="2.5"
          step="0.05"
          class="mini-slider led-glow-slider"
          value={props.ledGlow()}
          onInput={(e) => {
            const val = parseFloat(e.currentTarget.value)
            props.onSetLedGlow(val)
          }}
        />
      </div>

      <div class="panel-items">
        <For each={props.tracks()}>
          {(tr) => {
            // Resolve from the active theme or customColor so the swatch matches what
            // NoteRenderer and KeyboardRenderer actually paint.
            const color = (): string => hexToCSS(getTrackColor(tr, props.theme()))
            return (
              <label class="track-item">
                <div class="track-color-picker-wrap" title="Scegli colore traccia">
                  <span class="track-swatch" style={{ background: color() }} />
                  <input
                    type="color"
                    class="track-color-input"
                    value={color()}
                    aria-label={`Colore per ${tr.name}`}
                    onInput={(e) => {
                      e.stopPropagation()
                      const hex = e.currentTarget.value
                      const num = parseInt(hex.slice(1), 16)
                      tr.customColor = num
                      props.onTrackColorChange(tr.id, num)
                    }}
                  />
                </div>
                <span class="track-info">
                  <span class="track-name">{tr.name}</span>
                  <span class="track-meta">
                    {tn('tracks.notes', tr.notes.length, { channel: tr.channel + 1 })}
                  </span>
                </span>
                <span class="track-toggle-wrap" style={{ '--track-color': color() }}>
                  <input
                    type="checkbox"
                    class="track-toggle"
                    data-id={tr.id}
                    checked={props.isTrackEnabled(tr.id)}
                    onChange={(e) => {
                      e.stopPropagation()
                      const enabled = e.currentTarget.checked
                      props.renderer.setTrackVisible(tr.id, enabled)
                      props.onTrackEnabledChange(tr.id, enabled)
                    }}
                  />
                  <span class="toggle-track" />
                </span>
              </label>
            )
          }}
        </For>
      </div>
      <div class="panel-footer">
        <button class="panel-load-btn" type="button" onClick={() => props.onLoadNew()}>
          <span innerHTML={icons.upload(11)} />
          {t('tracks.loadNew')}
        </button>
      </div>
    </div>
  )
}

export class TrackPanel {
  private disposeRoot: (() => void) | null = null
  private wrapper: HTMLDivElement | null = null
  private panelEl: HTMLElement | null = null
  private trigger: HTMLElement | null = null

  private readonly setIsOpen: (v: boolean) => void
  private readonly isOpenFn: () => boolean
  private readonly setIsSheet: (v: boolean) => void
  private readonly setTracks: (v: readonly MidiTrack[]) => void
  private readonly setThemeSig: (v: Theme) => void
  private readonly setLedGlowSig: (v: number) => void
  private readonly ledGlowSig: () => number

  public onSetLedGlow: ((val: number) => void) | null = null
  public onTrackColorChange: ((trackId: string, color: number) => void) | null = null

  private onDocPointer = (e: PointerEvent): void => {
    const target = e.target as Node
    if (this.panelEl?.contains(target)) return
    if (this.trigger?.contains(target)) return
    this.close()
  }
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpenFn()) this.close()
  }
  private onResize = (): void => {
    if (!this.isOpenFn()) return
    // Sheet mode is CSS-driven; if the breakpoint flipped while open, close
    // rather than present a half-styled popover.
    if (this.panelEl?.classList.contains('popover--sheet') || isNarrowViewport()) {
      this.close()
      return
    }
    this.positionUnder()
  }

  constructor(
    container: HTMLElement,
    renderer: PianoRollRenderer,
    onTrackEnabledChange: (trackId: string, enabled: boolean) => void,
    onLoadNew: () => void,
    isTrackEnabled: (trackId: string) => boolean = () => true,
  ) {
    const [isOpen, setIsOpen] = createSignal(false)
    const [isSheet, setIsSheet] = createSignal(false)
    const [tracks, setTracks] = createSignal<readonly MidiTrack[]>([])
    const [theme, setThemeSig] = createSignal<Theme>(renderer.currentTheme)
    const [ledGlow, setLedGlowSig] = createSignal(1.0)
    this.isOpenFn = isOpen
    this.setIsOpen = setIsOpen
    this.setIsSheet = setIsSheet
    this.setTracks = setTracks
    this.setThemeSig = setThemeSig
    this.setLedGlowSig = setLedGlowSig
    this.ledGlowSig = ledGlow

    const wrapper = document.createElement('div')
    container.appendChild(wrapper)
    this.wrapper = wrapper
    this.disposeRoot = render(
      () => (
        <TrackPanelView
          isOpen={isOpen}
          isSheet={isSheet}
          tracks={tracks}
          theme={theme}
          renderer={renderer}
          onTrackEnabledChange={onTrackEnabledChange}
          onTrackColorChange={(trackId, color) => {
            // Trigger reactive update by cloning tracks array
            setTracks([...tracks()])
            renderer.presentFrame()
            this.onTrackColorChange?.(trackId, color)
          }}
          ledGlow={ledGlow}
          onSetLedGlow={(val) => {
            setLedGlowSig(val)
            this.onSetLedGlow?.(val)
          }}
          isTrackEnabled={isTrackEnabled}
          onLoadNew={() => {
            this.close()
            onLoadNew()
          }}
          registerPanelEl={(el) => {
            this.panelEl = el
          }}
        />
      ),
      wrapper,
    )
  }

  setLedGlow(val: number): void {
    this.setLedGlowSig(val)
  }

  render(midi: MidiFile): void {
    this.setTracks(midi.tracks)
  }

  setTheme(theme: Theme): void {
    this.setThemeSig(theme)
  }

  setTrigger(el: HTMLElement): void {
    this.trigger = el
  }

  toggle(): void {
    if (this.isOpenFn()) this.close()
    else this.open()
  }

  open(): void {
    if (this.isOpenFn()) return
    this.setIsOpen(true)
    if (isNarrowViewport()) {
      this.setIsSheet(true)
      if (this.panelEl) {
        this.panelEl.style.top = ''
        this.panelEl.style.right = ''
        this.panelEl.style.left = ''
      }
    } else {
      this.setIsSheet(false)
      this.positionUnder()
    }
    // Defer listener attach so the click that opened us doesn't immediately
    // bubble and close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', this.onDocPointer)
      document.addEventListener('keydown', this.onKey)
      window.addEventListener('resize', this.onResize)
    }, 0)
  }

  close(): void {
    if (!this.isOpenFn()) return
    this.setIsOpen(false)
    this.setIsSheet(false)
    document.removeEventListener('pointerdown', this.onDocPointer)
    document.removeEventListener('keydown', this.onKey)
    window.removeEventListener('resize', this.onResize)
  }

  hide(): void {
    this.close()
  }

  dispose(): void {
    this.close()
    this.disposeRoot?.()
    this.disposeRoot = null
    this.wrapper?.remove()
    this.wrapper = null
  }

  private positionUnder(): void {
    const trigger = this.trigger
    const panel = this.panelEl
    if (!trigger || !panel) return
    const rect = trigger.getBoundingClientRect()
    const panelW = panel.offsetWidth || 320
    const right = Math.max(12, window.innerWidth - rect.right)
    const top = rect.bottom + 8
    panel.style.right = `${right}px`
    panel.style.top = `${top}px`
    panel.style.left = ''
    const desiredLeft = window.innerWidth - right - panelW
    if (desiredLeft < 12) panel.style.right = `${Math.max(12, window.innerWidth - panelW - 12)}px`
  }
}
