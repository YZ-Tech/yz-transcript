#!/usr/bin/env node
// Copy the built IIFE + manifest to BOTH:
//   - frontend/public/modules/  (Vite source-of-truth for public assets)
//   - backend/jarvyz/web/static/modules/       (Jarvis production-serve dir, the
//                                actual outDir of the frontend's Vite build)
//
// Mirrors satellites/{music,people,wakeword-trainer}/ui/scripts/install-to-frontend.mjs.
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Layout: satellites/transcript/ui/scripts/ → climb 4 levels to project root
const iife = resolve(here, '..', 'dist-lib', 'yz-transcript.iife.js')
const manifestSrc = resolve(here, '..', '..', 'manifest.json')
const projectRoot = resolve(here, '..', '..', '..', '..')
const iifeTargets = [
  resolve(projectRoot, 'frontend', 'public', 'modules', 'yz-transcript.iife.js'),
  resolve(projectRoot, 'backend', 'jarvyz', 'web', 'static', 'modules', 'yz-transcript.iife.js'),
]
const manifestTargets = [
  resolve(projectRoot, 'frontend', 'public', 'modules', 'yz-transcript.manifest.json'),
  resolve(projectRoot, 'backend', 'jarvyz', 'web', 'static', 'modules', 'yz-transcript.manifest.json'),
]

try {
  statSync(iife)
} catch {
  console.error(`✗ ${iife} not found. Run \`npm run build:lib\` first.`)
  process.exit(1)
}

console.log(`✓ ${iife}`)
for (const dst of iifeTargets) {
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(iife, dst)
  const { size } = statSync(dst)
  console.log(`  → ${dst}`)
  console.log(`    ${(size / 1024).toFixed(1)} KB`)
}

console.log(`✓ ${manifestSrc}`)
for (const dst of manifestTargets) {
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(manifestSrc, dst)
  console.log(`  → ${dst}`)
}
