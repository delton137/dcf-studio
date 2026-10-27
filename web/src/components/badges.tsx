import clsx from 'clsx'
import type { ReactNode } from 'react'
import { SOURCE_LABEL, sourceColor } from '../lib/sources'
import { fmtPctSigned, upsideBg, upsideFg } from '../lib/format'
import { ACTIVE_STATUSES } from '../types/api'

export function SourceDot({ source, className }: { source?: string | null; className?: string }) {
  return (
    <span
      className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ background: sourceColor(source) }}
    />
  )
}

export function SourceBadge({ source, className, children }: { source?: string | null; className?: string; children?: ReactNode }) {
  const s = source ?? '?'
  return (
    <span
      className={clsx('chip font-semibold', className)}
      style={{ color: sourceColor(s), background: sourceColor(s, 0.12), boxShadow: `inset 0 0 0 1px ${sourceColor(s, 0.3)}` }}
    >
      <SourceDot source={s} className="h-1.5 w-1.5" />
      {SOURCE_LABEL[s] ?? s}
      {children}
    </span>
  )
}

type Tone = 'neutral' | 'pos' | 'neg' | 'warn' | 'accent' | 'muted'

const TONE: Record<Tone, string> = {
  neutral: 'bg-sunken text-fg ring-1 ring-inset ring-line',
  muted: 'bg-sunken text-muted ring-1 ring-inset ring-line',
  pos: 'bg-pos/10 text-pos ring-1 ring-inset ring-pos/30',
  neg: 'bg-neg/10 text-neg ring-1 ring-inset ring-neg/30',
  warn: 'bg-warn/10 text-warn ring-1 ring-inset ring-warn/30',
  accent: 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/30',
}

export function Chip({
  tone = 'neutral',
  children,
  title,
  className,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span className={clsx('chip', TONE[tone], className)} title={title}>
      {children}
    </span>
  )
}

export function statusTone(status?: string | null): Tone {
  switch (status) {
    case 'valid':
    case 'pass':
      return 'pos'
    case 'invalid':
    case 'failed':
    case 'fail':
      return 'neg'
    case 'cancelled':
    case 'interrupted':
    case 'warn':
      return 'warn'
    case 'queued':
    case 'running':
    case 'validating':
    case 'fixing':
      return 'accent'
    default:
      return 'muted'
  }
}

export function StatusBadge({ status, title }: { status?: string | null; title?: string }) {
  const active = !!status && ACTIVE_STATUSES.includes(status)
  return (
    <Chip tone={statusTone(status)} title={title}>
      {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status ?? 'unknown'}
    </Chip>
  )
}

export function ReproBadge({ grade, compact }: { grade?: string | null; compact?: boolean }) {
  if (!grade) return null
  const tone: Tone = grade === 'exact' ? 'muted' : grade === 'approx' ? 'warn' : 'neg'
  const title =
    grade === 'exact'
      ? 'Engine reproduces this model exactly: Layer-A what-ifs are exact'
      : grade === 'approx'
        ? 'Engine reproduces this model approximately: Layer-A changes applied as deltas'
        : 'Engine cannot reproduce this model: only bridge / share-count what-ifs'
  return (
    <Chip tone={tone} title={title}>
      {compact ? (grade === 'exact' ? 'repro' : grade === 'approx' ? '≈repro' : 'no repro') : `repro: ${grade}`}
    </Chip>
  )
}

export function LegacyBadge({ origin }: { origin?: string | null }) {
  if (origin === 'import')
    return (
      <Chip tone="muted" title="Imported from a legacy model">
        legacy
      </Chip>
    )
  if (origin === 'app_edit')
    return (
      <Chip tone="accent" title="Created in the app from a what-if">
        edit
      </Chip>
    )
  return null
}

export function QualityBadge({ quality }: { quality?: string | null }) {
  if (quality !== 'unverified') return null
  return (
    <Chip tone="warn" title="Legacy model quality not verified">
      unverified
    </Chip>
  )
}

export function LevelChip({ level }: { level?: string | null }) {
  return <Chip tone={statusTone(level)}>{level ?? '—'}</Chip>
}

export function AssumptionStatusChip({ status }: { status?: string | null }) {
  const tone: Tone =
    status === 'measured' ? 'pos' : status === 'derived' ? 'accent' : status === 'guided' ? 'neutral' : 'warn'
  return <Chip tone={tone}>{status ?? 'assumed'}</Chip>
}

export function UpsideChip({ value, title, className }: { value: number | null | undefined; title?: string; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-faint">—</span>
  return (
    <span
      className={clsx('num inline-block rounded px-1 py-px text-2xs font-semibold', className)}
      style={{ background: upsideBg(value), color: upsideFg(value) }}
      title={title}
    >
      {fmtPctSigned(value)}
    </span>
  )
}
