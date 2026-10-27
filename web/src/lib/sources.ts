import type { Source } from '../types/api'

export const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  agy: 'Antigravity',
}

/** CSS colour expression for a source (theme-aware through CSS variables). */
export function sourceColor(src: string | null | undefined, alpha = 1): string {
  const v = src === 'claude' || src === 'codex' || src === 'grok' || src === 'agy' ? `--src-${src}` : '--muted'
  return alpha >= 1 ? `rgb(var(${v}))` : `rgb(var(${v}) / ${alpha})`
}

/**
 * Colour for the n-th model of a source in one chart: the first is the pure source
 * colour, later ones (older versions / what-ifs) get lighter + dashed.
 */
export function seriesStyle(src: string, nth: number): { color: string; dash?: string; opacity: number } {
  if (nth <= 0) return { color: sourceColor(src), opacity: 1 }
  const dashes = ['6 3', '2 3', '8 3 2 3']
  return { color: sourceColor(src, Math.max(0.45, 0.85 - nth * 0.15)), dash: dashes[(nth - 1) % dashes.length], opacity: 0.85 }
}

export function isSource(s: unknown): s is Source {
  return s === 'claude' || s === 'codex' || s === 'grok' || s === 'agy'
}
