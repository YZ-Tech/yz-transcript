import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { makeLibConfig } from './scripts/vite-lib.mjs'

// Mode 'lib': IIFE module loaded by JarvYZ via @yz-dev/react-dynamic-module.
//   - Externalises react/react-dom (host injects via window globals).
//   - Bundles MUI/emotion (theme propagates via the ledfx theme-prop pattern,
//     same as music/people/wakeword-trainer satellite UIs).
//
// Mode 'pages' (default): standalone SPA. Built into ../yz_transcript/static/ so
// `pip install yz-transcript` users get a working UI at
// http://127.0.0.1:9004/.
// The IIFE lib recipe is the CANONICAL shared one (slug + global name
// derived from ../manifest.json) — see satellites/_ui-tooling/README.md.
const libConfig: UserConfig = makeLibConfig(import.meta.url, react)

const SAT = process.env.VITE_SATELLITE_URL || 'http://127.0.0.1:9004'

const pagesConfig: UserConfig = {
  plugins: [react()],
  server: {
    port: 5191,
    host: '127.0.0.1',
    proxy: {
      '/health': SAT,
      '/settings': SAT,
      '/entries': SAT,
      '/days': SAT,
      '/state': SAT,
      '/search': SAT,
      '/tools': SAT,
      '/events': { target: SAT, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../yz_transcript/static', import.meta.url)),
    emptyOutDir: true,
  },
}

export default defineConfig(({ mode }) => (mode === 'lib' ? libConfig : pagesConfig))
