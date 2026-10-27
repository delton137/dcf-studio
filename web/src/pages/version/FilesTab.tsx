import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useFileText, useFiles } from '../../api/hooks'
import { downloadUrl, exportXlsxUrl, fileUrl } from '../../api/client'
import { fmtBytes } from '../../lib/format'
import { Card, Empty, ErrorBox, Loading, Spinner, Toggle, errorMessage } from '../../components/ui'

const TEXT_EXT = ['.py', '.md', '.json', '.jsonl', '.txt', '.log', '.csv', '.toml', '.yaml', '.yml', '.html', '.xml', '.sh', '.tsv']
const MAX_AUTO = 1_500_000

function isText(path: string) {
  const p = path.toLowerCase()
  return TEXT_EXT.some((e) => p.endsWith(e)) || !p.includes('.')
}

const PREFERRED = ['model.py', 'legacy_adapter.py', 'convert.py', 'report.md', 'prompt.md', 'dcf.json']

export function FilesTab({ vid }: { vid: string }) {
  const q = useFiles(vid)
  const files = useMemo(() => q.data ?? [], [q.data])
  const [sel, setSel] = useState<string | null>(null)
  const [force, setForce] = useState(false)
  const [pretty, setPretty] = useState(true)
  const [wrap, setWrap] = useState(false)
  const [allLines, setAllLines] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState<string | null>(null)

  useEffect(() => {
    if (sel || !files.length) return
    const pick = PREFERRED.find((p) => files.some((f) => f.path === p)) ?? files.find((f) => isText(f.path))?.path ?? null
    setSel(pick)
  }, [files, sel])

  const entry = files.find((f) => f.path === sel)
  const canView = !!entry && isText(entry.path) && (entry.size <= MAX_AUTO || force)
  const text = useFileText(vid, canView ? sel : null)

  const shown = useMemo(() => {
    if (typeof text.data !== 'string') return ''
    if (pretty && sel?.endsWith('.json')) {
      try {
        return JSON.stringify(JSON.parse(text.data), null, 1)
      } catch {
        return text.data
      }
    }
    return text.data
  }, [text.data, pretty, sel])
  const lines = useMemo(() => shown.split('\n'), [shown])

  const doExport = async () => {
    setExporting(true)
    setExportErr(null)
    try {
      await downloadUrl(exportXlsxUrl(vid), `${vid}.xlsx`)
    } catch (e) {
      setExportErr(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  // group by top-level directory
  const groups = useMemo(() => {
    const m = new Map<string, typeof files>()
    for (const f of files) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
      if (!m.has(dir)) m.set(dir, [])
      m.get(dir)!.push(f)
    }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [files])

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
      <Card
        title={`Files (${files.length})`}
        actions={
          <button className="btn" onClick={doExport} disabled={exporting}>
            {exporting && <Spinner />}
            Export xlsx
          </button>
        }
      >
        {exportErr && <ErrorBox error={exportErr} title="Export" className="m-2" />}
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} className="m-2" />
        ) : files.length === 0 ? (
          <Empty>No files.</Empty>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {groups.map(([dir, fs]) => (
              <div key={dir}>
                {dir && <div className="px-3 pb-0.5 pt-2 font-mono text-2xs text-faint">{dir}/</div>}
                {fs.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => {
                      setSel(f.path)
                      setForce(false)
                      setAllLines(false)
                    }}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 px-3 py-0.5 text-left font-mono text-[11px] hover:bg-sunken',
                      sel === f.path && 'bg-sunken font-semibold text-fg',
                      !isText(f.path) && 'text-muted',
                    )}
                  >
                    <span className="truncate">{dir ? f.path.slice(dir.length + 1) : f.path}</span>
                    <span className="num shrink-0 text-2xs text-faint">{fmtBytes(f.size)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={<span className="font-mono normal-case tracking-normal text-fg">{sel ?? 'No file selected'}</span>}
        actions={
          sel ? (
            <>
              {sel.endsWith('.json') && <Toggle checked={pretty} onChange={setPretty} label="pretty" />}
              <Toggle checked={wrap} onChange={setWrap} label="wrap" />
              <a className="btn" href={fileUrl(vid, sel)} download={sel.split('/').pop()}>
                Download
              </a>
              <a className="btn btn-ghost" href={fileUrl(vid, sel)} target="_blank" rel="noreferrer">
                Raw ↗
              </a>
            </>
          ) : null
        }
      >
        {!entry ? (
          <Empty>Select a file.</Empty>
        ) : !isText(entry.path) ? (
          <Empty>Binary file ({fmtBytes(entry.size)}) — use Download.</Empty>
        ) : !canView ? (
          <Empty>
            Large file ({fmtBytes(entry.size)}).{' '}
            <button className="link" onClick={() => setForce(true)}>
              Load anyway
            </button>
          </Empty>
        ) : text.isLoading ? (
          <Loading />
        ) : text.error ? (
          <ErrorBox error={text.error} className="m-2" />
        ) : (
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full border-collapse font-mono text-[11.5px] leading-[1.45]">
              <tbody>
                {(allLines ? lines : lines.slice(0, 4000)).map((l, i) => (
                  <tr key={i}>
                    <td className="w-10 select-none border-r border-line bg-sunken px-2 text-right align-top text-faint">{i + 1}</td>
                    <td className={clsx('px-3 align-top', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>{l || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!allLines && lines.length > 4000 && (
              <div className="p-2 text-center text-xs">
                Showing 4,000 of {lines.length.toLocaleString()} lines.{' '}
                <button className="link" onClick={() => setAllLines(true)}>
                  Show all
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
