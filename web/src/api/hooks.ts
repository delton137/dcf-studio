import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, runEventsUrl, screenerApi } from './client'
import type { Knobs, RunEvent, RunRequest, WhatIfRequest } from '../types/api'
import { ACTIVE_STATUSES } from '../types/api'
import type { AgentRequest, ListMember, Screen, ScreenerStatus } from '../types/screener'

export const qk = {
  config: ['config'] as const,
  summary: ['summary'] as const,
  ticker: (t: string) => ['ticker', t] as const,
  compare: (t: string, v: string[]) => ['compare', t, v.join(',')] as const,
  version: (vid: string) => ['version', vid] as const,
  files: (vid: string) => ['files', vid] as const,
  file: (vid: string, path: string) => ['file', vid, path] as const,
  report: (vid: string) => ['report', vid] as const,
  whatifs: (vid: string) => ['whatifs', vid] as const,
  runs: (active: boolean) => ['runs', active] as const,
  run: (vid: string) => ['run', vid] as const,
  imports: ['imports'] as const,
  sc: {
    all: ['screener'] as const,
    status: ['screener', 'status'] as const,
    fields: ['screener', 'fields'] as const,
    presets: ['screener', 'presets'] as const,
    query: (key: string) => ['screener', 'query', key] as const,
    row: (sym: string) => ['screener', 'row', sym] as const,
    sectors: ['screener', 'sectors'] as const,
    screens: ['screener', 'screens'] as const,
    universes: ['screener', 'universes'] as const,
    universe: (slug: string) => ['screener', 'universe', slug] as const,
    agentRuns: ['screener', 'agent-runs'] as const,
    agentResult: (vid: string) => ['screener', 'agent', vid] as const,
  },
}

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: 60_000 })
}

/** Re-run the CLI model discovery (~2 s), then reload /config. */
export function useRefreshModels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.refreshModels(),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.config }),
  })
}

export function useSummary() {
  return useQuery({ queryKey: qk.summary, queryFn: api.summary, refetchInterval: 15_000 })
}

export function useTicker(ticker: string | undefined) {
  return useQuery({
    queryKey: qk.ticker(ticker ?? ''),
    queryFn: () => api.ticker(ticker!),
    enabled: !!ticker,
    refetchInterval: 20_000,
  })
}

export function useCompare(ticker: string | undefined, versions: string[]) {
  return useQuery({
    queryKey: qk.compare(ticker ?? '', versions),
    queryFn: () => api.compare(ticker!, versions),
    enabled: !!ticker,
    placeholderData: keepPreviousData,
  })
}

export function useVersion(vid: string | undefined) {
  return useQuery({
    queryKey: qk.version(vid ?? ''),
    queryFn: () => api.version(vid!),
    enabled: !!vid,
    refetchInterval: (q) => {
      const st = q.state.data?.summary?.status
      return st && ACTIVE_STATUSES.includes(st) ? 5000 : false
    },
  })
}

export function useFiles(vid: string | undefined) {
  return useQuery({ queryKey: qk.files(vid ?? ''), queryFn: () => api.files(vid!), enabled: !!vid })
}

export function useFileText(vid: string | undefined, path: string | null) {
  return useQuery({
    queryKey: qk.file(vid ?? '', path ?? ''),
    queryFn: () => api.fileText(vid!, path!),
    enabled: !!vid && !!path,
    staleTime: 30_000,
  })
}

export function useReport(vid: string | undefined) {
  return useQuery({ queryKey: qk.report(vid ?? ''), queryFn: () => api.report(vid!), enabled: !!vid })
}

export function useWhatifs(vid: string | undefined) {
  return useQuery({ queryKey: qk.whatifs(vid ?? ''), queryFn: () => api.whatifs(vid!), enabled: !!vid })
}

/** Live what-if recompute. The request is a pure function of its body, so it is cached as a query. */
export function useWhatIf(vid: string | undefined, body: WhatIfRequest | null) {
  const key = JSON.stringify(body ?? null)
  return useQuery({
    queryKey: ['whatif', vid ?? '', key],
    queryFn: ({ signal }) => api.whatif(vid!, body!, signal),
    enabled: !!vid && !!body,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  })
}

export function useSaveWhatif(vid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { name: string; knobs: Knobs; overrides: Record<string, unknown>; note?: string }) =>
      api.saveWhatif(vid, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.whatifs(vid) }),
  })
}

export function usePromoteWhatif(vid: string, ticker?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { name: string; knobs: Knobs; overrides: Record<string, unknown>; note?: string }) =>
      api.promote(vid, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.summary })
      if (ticker) qc.invalidateQueries({ queryKey: qk.ticker(ticker) })
    },
  })
}

export function useDeleteWhatif(vid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => api.deleteWhatif(vid, slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.whatifs(vid) }),
  })
}

export function useRuns(active: boolean, refetchMs: number | false = active ? 5000 : 10_000) {
  return useQuery({ queryKey: qk.runs(active), queryFn: () => api.runs(active), refetchInterval: refetchMs })
}

export function useRun(vid: string | undefined, opts?: { poll?: boolean; staleTime?: number }) {
  return useQuery({
    queryKey: qk.run(vid ?? ''),
    queryFn: () => api.run(vid!),
    enabled: !!vid,
    staleTime: opts?.staleTime,
    refetchInterval: (q) => {
      if (opts?.poll === false) return false
      const st = q.state.data?.run?.status
      return !st || ACTIVE_STATUSES.includes(st) ? 3000 : false
    },
  })
}

export function useImports() {
  return useQuery({
    queryKey: qk.imports,
    queryFn: api.imports,
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? []
      return items.some((i) => ['queued', 'running', 'validating', 'fixing'].includes(i.status)) ? 4000 : 20_000
    },
    retry: 1,
  })
}

export function useStartRuns() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: RunRequest) => api.startRuns(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: qk.summary })
      qc.invalidateQueries({ queryKey: ['ticker'] })
    },
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vid: string) => api.cancelRun(vid),
    onSuccess: (_d, vid) => {
      qc.invalidateQueries({ queryKey: qk.run(vid) })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })
}

export function useRefreshPrices() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tickers?: string[]) => api.refreshPrices(tickers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.summary })
      qc.invalidateQueries({ queryKey: ['ticker'] })
      qc.invalidateQueries({ queryKey: ['compare'] })
      qc.invalidateQueries({ queryKey: ['version'] })
    },
  })
}

export function usePutPrice(ticker: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (price: number) => api.putPrice(ticker, price),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.summary })
      qc.invalidateQueries({ queryKey: ['ticker'] })
      qc.invalidateQueries({ queryKey: ['compare'] })
      qc.invalidateQueries({ queryKey: ['version'] })
    },
  })
}

export function useRunImports() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { legacy_ids?: string[]; all?: boolean }) => api.runImports(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.imports })
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: qk.summary })
    },
  })
}

/** Debounce a value (used for live what-if recompute). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export type StreamState = 'connecting' | 'open' | 'ended' | 'error'

/**
 * Live run log over SSE (`/runs/{vid}/events?after=N`). Events are de-duplicated
 * by seq; on a dropped connection it reconnects from the last seq it saw.
 */
export function useRunEvents(vid: string | undefined) {
  const [events, setEvents] = useState<RunEvent[]>([])
  const [state, setState] = useState<StreamState>('connecting')
  const [endStatus, setEndStatus] = useState<string | null>(null)
  const lastSeq = useRef(0)
  const qc = useQueryClient()

  useEffect(() => {
    if (!vid) return
    setEvents([])
    setState('connecting')
    setEndStatus(null)
    lastSeq.current = 0
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false
    let failures = 0
    let buffer: RunEvent[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      flushTimer = null
      if (!buffer.length) return
      const batch = buffer
      buffer = []
      setEvents((prev) => [...prev, ...batch])
    }

    const connect = () => {
      if (closed) return
      es = new EventSource(runEventsUrl(vid, lastSeq.current))
      es.onopen = () => {
        failures = 0
        setState('open')
      }
      es.addEventListener('log', (e) => {
        try {
          const ev = JSON.parse((e as MessageEvent).data) as RunEvent
          if (typeof ev.seq === 'number' && ev.seq <= lastSeq.current) return
          lastSeq.current = Math.max(lastSeq.current, ev.seq ?? lastSeq.current + 1)
          buffer.push(ev)
          if (!flushTimer) flushTimer = setTimeout(flush, 120)
        } catch {
          /* ignore malformed */
        }
      })
      es.addEventListener('end', (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as { status?: string }
          setEndStatus(d.status ?? null)
        } catch {
          setEndStatus(null)
        }
        flush()
        setState('ended')
        closed = true
        es?.close()
        qc.invalidateQueries({ queryKey: qk.run(vid) })
        qc.invalidateQueries({ queryKey: qk.version(vid) })
      })
      es.onerror = () => {
        es?.close()
        if (closed) return
        failures += 1
        setState('error')
        retry = setTimeout(connect, Math.min(1000 * 2 ** failures, 15_000))
      }
    }
    connect()
    return () => {
      closed = true
      es?.close()
      if (retry) clearTimeout(retry)
      if (flushTimer) clearTimeout(flushTimer)
    }
  }, [vid, qc])

  return { events, state, endStatus }
}

/* ------------------------------------------------------------------ screener */

export function screenerBusy(st: ScreenerStatus | undefined): boolean {
  if (!st) return false
  return st.state === 'running' || Object.values(st.jobs ?? {}).some((j) => j?.state === 'running')
}

/** Screener data status; polls every second while a refresh / enrich / refine job runs. */
export function useScreenerStatus() {
  return useQuery({
    queryKey: qk.sc.status,
    queryFn: screenerApi.status,
    refetchInterval: (q) => (screenerBusy(q.state.data) ? 1000 : 30_000),
  })
}

export function useScreenerFields() {
  return useQuery({ queryKey: qk.sc.fields, queryFn: screenerApi.fields, staleTime: 10 * 60_000 })
}

export function useScreenerPresets() {
  return useQuery({ queryKey: qk.sc.presets, queryFn: screenerApi.presets, staleTime: 10 * 60_000 })
}

/** POST /query for a screen (pass an already-debounced screen without `cols`). */
export function useScreenerQuery(screen: Omit<Screen, 'cols'> | null) {
  const key = JSON.stringify(screen ?? null)
  return useQuery({
    queryKey: qk.sc.query(key),
    queryFn: ({ signal }) => screenerApi.query(screen!, undefined, signal),
    enabled: !!screen,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  })
}

export function useScreenerRow(symbol: string | null | undefined) {
  return useQuery({
    queryKey: qk.sc.row(symbol ?? ''),
    queryFn: () => screenerApi.row(symbol!),
    enabled: !!symbol,
    retry: false,
  })
}

export function useScreenerSectors() {
  return useQuery({ queryKey: qk.sc.sectors, queryFn: screenerApi.sectors, staleTime: 10 * 60_000 })
}

export function useSavedScreens() {
  return useQuery({ queryKey: qk.sc.screens, queryFn: screenerApi.screens })
}

export function useSaveScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { slug: string; name: string; screen: Screen; note?: string }) =>
      screenerApi.saveScreen(b.slug, { name: b.name, screen: b.screen, note: b.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sc.screens }),
  })
}

export function useDeleteScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => screenerApi.deleteScreen(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sc.screens }),
  })
}

export function useUniverses() {
  return useQuery({ queryKey: qk.sc.universes, queryFn: screenerApi.universes, staleTime: 15_000 })
}

export function useUniverseDoc(slug: string | null | undefined) {
  return useQuery({
    queryKey: qk.sc.universe(slug ?? ''),
    queryFn: () => screenerApi.universe(slug!),
    enabled: !!slug,
    retry: false,
  })
}

function invalidateLists(qc: ReturnType<typeof useQueryClient>, slug?: string) {
  qc.invalidateQueries({ queryKey: qk.sc.universes })
  if (slug) qc.invalidateQueries({ queryKey: qk.sc.universe(slug) })
  qc.invalidateQueries({ queryKey: ['screener', 'query'] })
}

export function usePutUniverse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { slug: string; name: string; members: (ListMember | string)[]; kind?: string }) =>
      screenerApi.putUniverse(b.slug, { name: b.name, members: b.members, kind: b.kind }),
    onSuccess: (d) => invalidateLists(qc, d.slug),
  })
}

export function useDeleteUniverse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => screenerApi.deleteUniverse(slug),
    onSuccess: (_d, slug) => invalidateLists(qc, slug),
  })
}

export function useAddMembers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { slug: string; symbols: string[] }) => screenerApi.addMembers(b.slug, b.symbols),
    onSuccess: (d) => invalidateLists(qc, d.slug),
  })
}

export function useRefreshScreener() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force: boolean) => screenerApi.refresh(force),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sc.status }),
  })
}

export function useEnrich() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (symbols: string[]) => screenerApi.enrich(symbols),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sc.status }),
  })
}

export function useRefine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (symbols: string[]) => screenerApi.refine(symbols),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sc.status }),
  })
}

export function useStartAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: AgentRequest) => screenerApi.startAgent(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sc.agentRuns })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })
}

export function useAgentRuns() {
  return useQuery({
    queryKey: qk.sc.agentRuns,
    queryFn: screenerApi.agentRuns,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status && ACTIVE_STATUSES.includes(r.status)) ? 4000 : 30_000,
  })
}

export function useAgentResult(vid: string | null | undefined) {
  return useQuery({
    queryKey: qk.sc.agentResult(vid ?? ''),
    queryFn: () => screenerApi.agentResult(vid!),
    enabled: !!vid,
    refetchInterval: (q) => {
      const st = q.state.data?.run?.status
      return !st || ACTIVE_STATUSES.includes(st) ? 3000 : false
    },
  })
}
