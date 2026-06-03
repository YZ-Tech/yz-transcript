// Lib (IIFE) entry. The IIFE attaches these exports to `window.YzTranscript`;
// JarvYZ loads it via @yz-dev/react-dynamic-module.
export { TranscriptPage } from './TranscriptPage'
export type { TranscriptPageProps } from './TranscriptPage'
export type { WSApi } from './lib/ws'
export type { Capabilities } from './lib/capabilities'
export {
  createSatelliteApi,
  createJarvYZApi,
  NotSupportedError,
} from './lib/api'
export type { TranscriptApi } from './lib/api'
export type {
  TranscriptDay,
  TranscriptEntry,
  TranscriptListResponse,
  TranscriptState,
  SearchHit,
  SearchResponse,
} from './types'
