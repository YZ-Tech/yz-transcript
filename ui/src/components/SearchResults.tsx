import { Box, Chip, CircularProgress, Stack, Typography } from '@mui/material'
import type { SearchHit } from '../types'

/** Semantic search results — chronologically-tagged with score chip.
 *  Click a hit → ideally jump to that day in the day-picker; for now
 *  surfaces the day as a chip so the user can navigate manually.
 *
 *  Renders distinct searching / error / warming / no-match states so an
 *  in-flight search never masquerades as "No matches". */
export function SearchResults({
  hits,
  loading = false,
  error = null,
  ready = true,
}: {
  hits: SearchHit[]
  loading?: boolean
  error?: string | null
  ready?: boolean
}) {
  // In-flight with nothing to show yet → "Searching…", not "No matches".
  // (If stale hits exist we keep showing them — stale-while-revalidate;
  // the SearchBar spinner signals the refresh.)
  if (loading && hits.length === 0) {
    return (
      <Stack sx={{ alignItems: 'center', gap: 1.5, py: 4, color: 'text.secondary' }}>
        <CircularProgress size={26} />
        <Typography variant="body2">Searching all history…</Typography>
      </Stack>
    )
  }
  if (error) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="error.main">
          Search failed: {error}
        </Typography>
      </Box>
    )
  }
  if (!ready) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.disabled">
          Semantic index is warming up — try again in a moment.
        </Typography>
      </Box>
    )
  }
  if (hits.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.disabled">
          No matches.
        </Typography>
      </Box>
    )
  }
  return (
    <Stack spacing={0.75}>
      {hits.map((h) => (
        <HitRow key={`${h.day}-${h.ts}`} hit={h} />
      ))}
    </Stack>
  )
}

function HitRow({ hit }: { hit: SearchHit }) {
  const when = new Date(hit.ts * 1000).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <Box
      sx={{
        p: 1.25,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Chip
          label={hit.day}
          size="small"
          variant="outlined"
          sx={{ height: 18, fontSize: '0.6rem' }}
        />
        <Typography
          variant="caption"
          sx={{ fontFamily: 'ui-monospace, monospace', color: 'text.disabled' }}
        >
          {when}
        </Typography>
        <Chip
          label={(hit.language || '?').toUpperCase()}
          size="small"
          variant="outlined"
          sx={{ height: 18, fontSize: '0.6rem' }}
        />
        <Chip
          label={`score ${hit.score.toFixed(2)}`}
          size="small"
          color={hit.score > 0.5 ? 'success' : hit.score > 0.2 ? 'default' : 'warning'}
          variant="outlined"
          sx={{ height: 18, fontSize: '0.6rem' }}
        />
      </Stack>
      <Typography variant="body2" sx={{ pl: 0.5, fontFamily: 'Georgia, serif' }}>
        {hit.text}
      </Typography>
    </Box>
  )
}
