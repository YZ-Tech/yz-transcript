import { createContext, useContext } from 'react'

export interface Capabilities {
  /** Empty for JarvYZ-embedded (JarvYZ serves the proxy), same-origin
   *  for standalone (satellite serves the SPA itself). */
  apiBase: string
  deployTarget: 'jarvis' | 'standalone'
  /** When true, audio playback URLs work. False in standalone mode (the
   *  satellite is text-only — audio clips live on JarvYZ's filesystem). */
  hasAudio: boolean
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  apiBase: '',
  deployTarget: 'jarvis',
  hasAudio: true,
}

export const CapabilitiesContext = createContext<Capabilities>(DEFAULT_CAPABILITIES)

export const useCapabilities = () => useContext(CapabilitiesContext)
