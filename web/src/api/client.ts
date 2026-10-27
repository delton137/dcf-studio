import type {
  ConfigResponse,
  FileEntry,
  ImportLaunchResponse,
  ImportsResponse,
  PriceQuote,
  RunEvent,
  RunMeta,
  RunRequest,
  RunResponse,
  RunStarted,
  SavedWhatIf,
  SummaryResponse,
  TickerResponse,
  VersionResponse,
  Dcf,
  VersionSummary,
  WhatIfRequest,
  WhatIfResponse,
  Knobs,
  Validation,
} from '../types/api'
import type {
  AgentRequest,
  AgentResult,
  AgentRunMeta,
  FieldsResponse,
  ListMember,
  Preset,
  QueryResponse,
  RowDetail,
  SavedScreen,
  Screen,
  ScreenerStatus,
  SectorsResponse,
  UniverseDoc,
  UniversesResponse,
} from '../types/screener'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

const enc = encodeURIComponent

function detailToString(detail: unknown): string {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc, msg, type}]
    return detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = Array.isArray((d as { loc?: unknown[] }).loc) ? (d as { loc: unknown[] }).loc.join('.') : ''
          return `${loc ? loc + ': ' : ''}${String((d as { msg: unknown }).msg)}`
        }
        return JSON.stringify(d)
      })
      .join('; ')
  }
  return JSON.stringify(detail)
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown; text?: boolean }): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body = init?.body
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init?.headers as object) }, body })
  } catch (e) {
    throw new ApiError(0, `Network error: ${(e as Error).message}. Is the server running at 127.0.0.1:8765?`)
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    const raw = await res.text().catch(() => '')
    if (raw) {
      try {
        const j = JSON.parse(raw) as { detail?: unknown }
        msg = detailToString(j.detail ?? j) || msg
      } catch {
        msg = raw.length > 400 ? raw.slice(0, 400) + '…' : raw
      }
    }
    throw new ApiError(res.status, msg)
  }
  if (init?.text) return (await res.text()) as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as T
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  config: () => request<ConfigResponse>('/config'),
  refreshModels: () =>
    request<{ fetched_at?: string | null; errors?: Record<string, string> }>('/config/models/refresh', { method: 'POST' }),
  summary: () => request<SummaryResponse>('/summary'),
  ticker: (t: string) => request<TickerResponse>(`/tickers/${enc(t)}`),
  compare: (t: string, versions?: string[]) =>
    request<{ ticker: string; compare_price?: PriceQuote | null; models: { summary: VersionSummary | null; dcf: Dcf }[] }>(
      `/tickers/${enc(t)}/compare${versions && versions.length ? `?versions=${versions.map(enc).join(',')}` : ''}`,
    ),
  version: (vid: string) => request<VersionResponse>(`/versions/${enc(vid)}`),
  files: (vid: string) => request<FileEntry[]>(`/versions/${enc(vid)}/files`),
  fileText: (vid: string, path: string) =>
    request<string>(`/versions/${enc(vid)}/file?path=${enc(path)}`, { text: true }),
  report: (vid: string) => request<string>(`/versions/${enc(vid)}/report`, { text: true }),
  whatif: (vid: string, body: WhatIfRequest, signal?: AbortSignal) =>
    request<WhatIfResponse>(`/versions/${enc(vid)}/whatif`, { method: 'POST', json: body, signal }),
  whatifs: (vid: string) => request<SavedWhatIf[]>(`/versions/${enc(vid)}/whatifs`),
  saveWhatif: (vid: string, body: { name: string; knobs: Knobs; overrides: Record<string, unknown>; note?: string }) =>
    request<SavedWhatIf>(`/versions/${enc(vid)}/whatifs`, { method: 'POST', json: body }),
  promote: (vid: string, body: { name: string; knobs: Knobs; overrides: Record<string, unknown>; note?: string }) =>
    request<{ version_id: string; validation?: Validation | null }>(`/versions/${enc(vid)}/promote`, {
      method: 'POST',
      json: body,
    }),
  deleteWhatif: (vid: string, slug: string) =>
    request<{ deleted: boolean }>(`/versions/${enc(vid)}/whatifs/${enc(slug)}`, { method: 'DELETE' }),
  startRuns: (body: RunRequest) => request<{ runs: RunStarted[] }>('/runs', { method: 'POST', json: body }),
  runs: (active = false) => request<RunMeta[]>(`/runs${active ? '?active=true' : ''}`),
  run: (vid: string) => request<RunResponse>(`/runs/${enc(vid)}`),
  runEvents: (vid: string, after = 0) => request<RunEvent[]>(`/runs/${enc(vid)}/events.json?after=${after}`),
  cancelRun: (vid: string) => request<{ cancelled: boolean }>(`/runs/${enc(vid)}/cancel`, { method: 'POST' }),
  price: (t: string) => request<PriceQuote>(`/prices/${enc(t)}`),
  refreshPrices: (tickers?: string[]) =>
    request<Record<string, PriceQuote>>('/prices/refresh', { method: 'POST', json: tickers ? { tickers } : {} }),
  putPrice: (t: string, price: number) =>
    request<PriceQuote>(`/prices/${enc(t)}`, { method: 'PUT', json: { price } }),
  imports: () => request<ImportsResponse>('/imports'),
  runImports: (body: { legacy_ids?: string[]; all?: boolean }) =>
    request<ImportLaunchResponse>('/imports/run', { method: 'POST', json: body }),
}

/** Screener (`/api/screener/*`). */
export const screenerApi = {
  status: () => request<ScreenerStatus>('/screener/status'),
  refresh: (force = false) => request<{ started: boolean }>('/screener/refresh', { method: 'POST', json: { force } }),
  fields: () => request<FieldsResponse>('/screener/fields'),
  presets: () => request<Preset[]>('/screener/presets'),
  query: (screen: Omit<Screen, 'cols'>, limit?: number, signal?: AbortSignal) =>
    request<QueryResponse>('/screener/query', { method: 'POST', json: { screen, limit }, signal }),
  row: (symbol: string) => request<RowDetail>(`/screener/rows/${enc(symbol)}`),
  sectors: () => request<SectorsResponse>('/screener/sectors'),
  enrich: (symbols: string[]) =>
    request<{ started: boolean; count: number }>('/screener/enrich', { method: 'POST', json: { symbols } }),
  refine: (symbols: string[]) =>
    request<{ started: boolean; count: number }>('/screener/refine', { method: 'POST', json: { symbols } }),
  screens: () => request<SavedScreen[]>('/screener/screens'),
  saveScreen: (slug: string, body: { name: string; screen: Screen; note?: string }) =>
    request<SavedScreen>(`/screener/screens/${enc(slug)}`, { method: 'PUT', json: body }),
  deleteScreen: (slug: string) => request<{ deleted: boolean }>(`/screener/screens/${enc(slug)}`, { method: 'DELETE' }),
  universes: () => request<UniversesResponse>('/screener/universes'),
  universe: (slug: string) => request<UniverseDoc>(`/screener/universes/${enc(slug)}`),
  putUniverse: (slug: string, body: { name: string; members: (ListMember | string)[]; kind?: string }) =>
    request<UniverseDoc>(`/screener/universes/${enc(slug)}`, { method: 'PUT', json: body }),
  deleteUniverse: (slug: string) => request<{ deleted: boolean }>(`/screener/universes/${enc(slug)}`, { method: 'DELETE' }),
  addMembers: (slug: string, symbols: string[]) =>
    request<UniverseDoc>(`/screener/universes/${enc(slug)}/members`, { method: 'POST', json: { symbols } }),
  startAgent: (body: AgentRequest) => request<{ version_id: string }>('/screener/agent', { method: 'POST', json: body }),
  agentRuns: () => request<AgentRunMeta[]>('/screener/agent'),
  agentResult: (vid: string) => request<AgentResult>(`/screener/agent/${enc(vid)}`),
}

export const fileUrl = (vid: string, path: string) => `/api/versions/${enc(vid)}/file?path=${enc(path)}`
export const exportXlsxUrl = (vid: string) => `/api/versions/${enc(vid)}/export.xlsx`
export const runEventsUrl = (vid: string, after = 0) => `/api/runs/${enc(vid)}/events?after=${after}`

/** Fetch a URL as a blob and trigger a browser download; throws ApiError on failure. */
export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = JSON.parse(raw) as { detail?: unknown }
      msg = detailToString(j.detail) || msg
    } catch {
      if (raw) msg = raw.slice(0, 300)
    }
    throw new ApiError(res.status, msg)
  }
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename="?([^";]+)"?/.exec(cd)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = m?.[1] || filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
