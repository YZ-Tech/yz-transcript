import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import PsychologyIcon from '@mui/icons-material/Psychology'
import { useTranscriptSearch } from '../hooks/useTranscript'
import type { SearchHit } from '../types'

/** Dual-mode search.
 *
 *  - KEYWORD mode: client-side substring filter over the currently-loaded
 *    day. Parent applies the filter; we just expose `query` upward via
 *    `onKeywordChange`. Fast, no satellite call.
 *  - SEMANTIC mode: POST `/search` (cosine sim over the multilingual
 *    MiniLM index). Returns ranked matches across ALL days, surfaced
 *    via `onResults`. Slower (~50–100 ms) but finds things keyword
 *    search misses (paraphrase, cross-language, synonyms).
 */
export function SearchBar({
  onKeywordChange,
  onResults,
  onClear,
  onSearchState,
}: {
  /** Current keyword query — empty string when semantic mode is active
   *  or the search is cleared. Parent uses this to filter its loaded
   *  entries client-side. */
  onKeywordChange: (q: string) => void
  /** Semantic search hits when mode='semantic' and the query is non-empty.
   *  Null when semantic mode is inactive / cleared. */
  onResults: (hits: SearchHit[] | null) => void
  /** Fired when the user explicitly clears the box (X button or Esc). */
  onClear: () => void
  /** Bubbles the underlying request state up so the parent's results
   *  area can show searching / error / warming instead of a misleading
   *  "No matches" while a query is in flight. */
  onSearchState?: (s: { loading: boolean; error: string | null; ready: boolean }) => void
}) {
  const [mode, setMode] = useState<'keyword' | 'semantic'>('keyword')
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState<'' | 'en' | 'de'>('')
  const { hits, ready, count, loading, error, run, clear } = useTranscriptSearch()

  // Bubble the keyword query upward whenever it changes in keyword mode.
  // In semantic mode the parent ignores keyword filtering — pass ''.
  useEffect(() => {
    onKeywordChange(mode === 'keyword' ? query : '')
  }, [mode, query, onKeywordChange])

  // Semantic search fires on debounce.
  useEffect(() => {
    if (mode === 'keyword') {
      onResults(null)
      return
    }
    if (!query.trim()) {
      onResults(null)
      clear()
      return
    }
    const handle = window.setTimeout(() => {
      void run({ q: query, language: language || undefined, limit: 20 })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [mode, query, language, run, clear, onResults])

  useEffect(() => {
    if (mode === 'semantic' && query.trim()) onResults(hits)
  }, [hits, mode, query, onResults])

  // Bubble request state up so SearchResults can distinguish
  // searching / error / warming / no-match.
  useEffect(() => {
    onSearchState?.({ loading, error, ready })
  }, [loading, error, ready, onSearchState])

  const placeholder = useMemo(
    () => (mode === 'keyword' ? 'Filter the loaded day…' : 'Search across all history…'),
    [mode],
  )

  const reset = () => {
    setQuery('')
    clear()
    onClear()
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 0.25,
          }}
        >
          <Tooltip title="Fast substring match over the loaded day">
            <Chip
              icon={<FlashOnIcon sx={{ fontSize: 14 }} />}
              label="keyword"
              size="small"
              color={mode === 'keyword' ? 'primary' : 'default'}
              variant={mode === 'keyword' ? 'filled' : 'outlined'}
              onClick={() => setMode('keyword')}
            />
          </Tooltip>
          <Tooltip title="Multilingual semantic search across all history">
            <Chip
              icon={<PsychologyIcon sx={{ fontSize: 14 }} />}
              label="semantic"
              size="small"
              color={mode === 'semantic' ? 'primary' : 'default'}
              variant={mode === 'semantic' ? 'filled' : 'outlined'}
              onClick={() => setMode('semantic')}
            />
          </Tooltip>
        </Stack>

        <TextField
          size="small"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: query && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={reset}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') reset()
          }}
        />

        {mode === 'semantic' && (
          <TextField
            select
            size="small"
            label="Lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value as '' | 'en' | 'de')}
            sx={{ minWidth: 90 }}
          >
            <MenuItem value="">any</MenuItem>
            <MenuItem value="en">en</MenuItem>
            <MenuItem value="de">de</MenuItem>
          </TextField>
        )}

        {mode === 'semantic' && loading && <CircularProgress size={20} />}
      </Stack>

      {mode === 'semantic' && query.trim() && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, mt: 0.5, display: 'block' }}>
          {error
            ? `error: ${error}`
            : !ready
              ? 'Index warming up — try again in a moment.'
              : `${hits.length} hit(s) · index has ${count} entries`}
        </Typography>
      )}
    </Box>
  )
}
