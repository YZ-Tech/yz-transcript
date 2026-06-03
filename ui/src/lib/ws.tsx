// Vendored WS context — same shape music/people/wakeword-trainer
// satellites use. React context can't cross the IIFE bundle boundary
// by identity, so the host's WSApi travels via prop into the
// module-side WSContext.

import { createContext, useContext, useEffect, useRef } from 'react'

export interface WSApi {
  send: (data: unknown) => void
  subscribe: (eventType: string, cb: (data: any) => void) => () => void
  isConnected: boolean
}

const NO_WS: WSApi = {
  send: () => {},
  subscribe: () => () => {},
  isConnected: false,
}

export const WSContext = createContext<WSApi>(NO_WS)

export const useWebSocket = () => useContext(WSContext)

/** Subscribe a component to a single WS event type. Callback is
 *  ref-stabilized — re-renders don't re-subscribe. Auto-cleans on unmount. */
export function useSubscription<T = any>(eventType: string, callback: (data: T) => void) {
  const { subscribe } = useWebSocket()
  const cbRef = useRef(callback)

  useEffect(() => {
    cbRef.current = callback
  })

  useEffect(() => {
    const handler = (data: T) => cbRef.current(data)
    return subscribe(eventType, handler)
  }, [eventType, subscribe])
}
