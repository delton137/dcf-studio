import type { Dcf, DcfGrid, DcfScenario } from '../../types/api'
import { fmtPS } from '../../lib/format'
import { baseScenario, mainTerminal, refPrice, scenarioVps } from '../../lib/derive'
import { Card, Empty } from '../../components/ui'
import { Heatmap, findBaseCell } from '../../components/Heatmap'

export function SensitivityTab({ dcf }: { dcf: Dcf }) {
  const grids = (dcf.grids ?? []) as DcfGrid[]
  const d = dcf.derived ?? {}
  const price = refPrice(d)
  const ccy = d.quote_currency ?? dcf.listing?.quote_currency ?? 'USD'
  if (!grids.length) return <Empty>This model has no sensitivity grids.</Empty>
  return (
    <div className="space-y-3">
      <div className="text-2xs text-muted">
        Cells are coloured by implied upside vs {d.compare_price ? 'the compare price' : "the model's own price"} ({fmtPS(price, ccy)}); the
        outlined cell is the scenario's own value.
      </div>
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        {grids.map((g, i) => {
          const scn: DcfScenario | undefined =
            ((dcf.scenarios ?? []).find((s) => s?.id === g.scenario_id) as DcfScenario | undefined) ?? baseScenario(dcf)
          const base = findBaseCell(g, scenarioVps(scn), { wacc: scn?.discounting?.wacc, g: mainTerminal(scn)?.g })
          return (
            <Card
              key={g.id ?? i}
              title={
                <span className="normal-case tracking-normal">
                  <span className="text-xs font-semibold text-fg">{g.label ?? g.id}</span>{' '}
                  <span className="text-2xs text-faint">
                    {g.scenario_id ? `scenario ${g.scenario_id} · ` : ''}output {g.output ?? 'value_ps'}
                  </span>
                </span>
              }
              bodyClassName="p-3"
            >
              <Heatmap grid={g} price={g.output === 'value_ps' || !g.output ? price : null} baseCell={base} ccy={ccy} />
            </Card>
          )
        })}
      </div>
    </div>
  )
}
