// Shapes shared by satellite-side server + UI + JarvYZ-side proxy.
//
// Kept verbatim from the pre-migration JarvYZ-side
// `frontend/src/pages/Dev/Transcript/types.ts` so the proxy + frontend
// fetches don't need to change.

export type TranscriptState = {
  enabled: boolean
  running: boolean
  paused: boolean
  retention: {
    text_days: number
    audio_days: number
  }
  /** Satellite-side projection. Optional because the standalone SPA
   *  reads `/state` directly (satellite owns everything in this branch).
   *  JarvYZ-side proxy adds it from the satellite's /state response. */
  satellite?: {
    today_count: number
    last_entry_ts: number | null
    index_ready: boolean
    index_count: number
    error?: string | null
  }
}

export type TranscriptEntry = {
  ts: number
  text: string
  language: string
  duration: number
  audio_path?: string
}

export type TranscriptDay = {
  day: string // YYYY-MM-DD
  size_bytes: number
  mtime: number
}

export type TranscriptListResponse = {
  day: string
  entries: TranscriptEntry[]
  total_day: number
}

export type SearchHit = TranscriptEntry & {
  day: string
  score: number
}

export type SearchResponse = {
  ready: boolean
  count: number
  entries: SearchHit[]
}
