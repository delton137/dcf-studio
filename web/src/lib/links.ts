/** Route builders. Version ids are opaque (may contain '.', e.g. BRK.B_…); always encode. */
export const vLink = (vid: string, tab?: string) => `/v/${encodeURIComponent(vid)}${tab ? `?tab=${tab}` : ''}`
export const tLink = (ticker: string, versions?: string[]) =>
  `/t/${encodeURIComponent(ticker)}${versions && versions.length ? `?v=${versions.map(encodeURIComponent).join(',')}` : ''}`
export const runLink = (vid: string) => `/runs/${encodeURIComponent(vid)}`
/** Screener agent jobs are runs with a pseudo-ticker ("_SCREENER"); they open in the screener's agent dialog. */
export const isAgentTicker = (t?: string | null) => !!t && t.startsWith('_')
export const screenerAgentLink = (vid: string) => `/screener?agent=${encodeURIComponent(vid)}`
