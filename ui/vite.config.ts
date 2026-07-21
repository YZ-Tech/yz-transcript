import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Mode 'lib': IIFE module loaded by JarvYZ via @yz-dev/react-dynamic-module.
//   - Externalises react/react-dom (host injects via window globals).
//   - Bundles MUI/emotion (theme propagates via the ledfx theme-prop pattern,
//     same as music/people/wakeword-trainer satellite UIs).
//
// Mode 'pages' (default): standalone SPA. Built into ../yz_transcript/static/ so
// `pip install yz-transcript` users get a working UI at
// http://127.0.0.1:9004/.
const libConfig: UserConfig = {
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'YzTranscript',
      formats: ['iife'],
      fileName: () => 'yz-transcript.iife.js',
    },
    // CJS require shim — same gotcha music/people hit. zustand v5 transitively
    // pulls `use-sync-external-store/shim/with-selector` which does a literal
    // `require("react")`. We don't actually use zustand in this UI (transcript
    // state is small + flat — local component state suffices), but keep the
    // banner for consistency with other satellite IIFEs.
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: { react: 'React', 'react-dom': 'ReactDOM' },
        exports: 'named',
        extend: true,
        banner:
          'var require = function(id) {' +
          ' if (id === "react") return window.React;' +
          ' if (id === "react-dom") return window.ReactDOM;' +
          ' throw new Error("require not handled: " + id);' +
          ' };',
      },
    },
  },
}

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
