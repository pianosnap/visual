/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'

// Preload the body font (Inter 400) so the woff2 fetch starts in parallel
// with HTML parse, not after CSS is parsed. Saves ~100-200 ms on LCP for
// first-time visitors. Other weights / Instrument Serif / JetBrains Mono
// load lazily via @font-face when the CSS resolves — fine, they're not
// above-the-fold.
const preloadBodyFont = (): Plugin => ({
  name: 'preload-body-font',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const bundle = ctx.bundle
      if (!bundle) return html
      const inter400 = Object.values(bundle).find(
        (c) => c.type === 'asset' && /(^|\/)inter-latin-400-normal-[^/]+\.woff2$/.test(c.fileName),
      )
      if (!inter400) return html
      const tag = `    <link rel="preload" as="font" type="font/woff2" crossorigin href="/${inter400.fileName}">\n`
      return html.replace('</head>', `${tag}</head>`)
    },
  },
})

export default defineConfig({
  plugins: [solid(), preloadBodyFont()],
  // Pre-bundle deps reached only via dynamic `import()` from the export path. Lazy
  // discovery can re-run the dep optimizer while the tab still references old
  // `node_modules/.vite/deps/*` URLs → 504 (Outdated Optimize Dep) + failed dynamic
  // import. Mediabunny → `import('./export/VideoExporter')`; lamejs → MP3 audio export.
  optimizeDeps: {
    include: ['mediabunny', '@breezystack/lamejs'],
  },
  resolve: {
    alias: {
      // @tonejs/piano's MidiInput module imports Node's 'events' — polyfill for browser
      events: 'events',
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  build: {
    // 'hidden' emits .map files next to the .js bundles but omits the
    // `//# sourceMappingURL=` comment, so prod users never download maps and
    // their stack traces stay opaque from devtools. The PostHog CLI
    // (`scripts/upload-sourcemaps.mjs`) reads those .map files at upload
    // time, injects a chunk-id, and ships them to PostHog where they're paired
    // with caught errors at view time.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Force every pixi.js module into a single `pixi` chunk.
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js')) return 'pixi'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/**/*.d.ts',
      ],
    },
  },
})
