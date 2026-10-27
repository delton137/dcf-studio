import { useReport } from '../../api/hooks'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'
import { Markdown } from '../../components/Markdown'

export function ReportTab({ vid }: { vid: string }) {
  const q = useReport(vid)
  if (q.isLoading) return <Loading label="Loading report…" />
  if (q.error) return <ErrorBox error={q.error} title="Report" />
  const text = typeof q.data === 'string' ? q.data : ''
  if (!text.trim()) return <Empty>No report.md for this version.</Empty>
  return (
    <Card bodyClassName="px-6 py-4">
      <Markdown>{text}</Markdown>
    </Card>
  )
}
