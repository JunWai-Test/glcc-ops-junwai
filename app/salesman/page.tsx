import { getRecords, rm, m } from '@/lib/records'
import Empty from '@/app/_components/Empty'

export const dynamic = 'force-dynamic'

// Your sales team. category === 'salesman'. Custom fields live in `meta`:
//   sales (RM achieved), calls (calls made), commission_pct.
export default async function SalesMan() {
  const all = await getRecords()
  const rows = all.filter(r => r.category === 'salesman')
  const target = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
  const sales = rows.reduce((s, r) => s + Number(r.meta?.sales || 0), 0)

  const cards: [string, string | number][] = [
    ['Salesmen', rows.length],
    ['Total target', rm(target)],
    ['Total sales', rm(sales)],
  ]

  return (
    <>
      <h1 className="ph">SalesMan</h1>
      <p className="cap">Your sales team — target, sales &amp; activity</p>
      <div className="grid">
        {cards.map(([l, v]) => (
          <div className="stat" key={l}><p className="l">{l}</p><p className="v">{v}</p></div>
        ))}
      </div>
      {rows.length === 0 ? <Empty /> : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Target</th><th>Sales</th><th>% to target</th><th>Calls</th><th>Commission</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const tgt = Number(r.amount || 0)
              const sold = Number(r.meta?.sales || 0)
              const pct = tgt > 0 ? Math.round((sold / tgt) * 100) : 0
              return (
                <tr key={r.id}>
                  <td data-label="Name">{r.title}</td>
                  <td data-label="Target">{tgt ? rm(tgt) : '—'}</td>
                  <td data-label="Sales">{sold ? rm(sold) : '—'}</td>
                  <td data-label="% to target"><span className={`pill ${pct >= 50 ? 'won' : 'overdue'}`}>{pct}%</span></td>
                  <td data-label="Calls">{m(r, 'calls')}</td>
                  <td data-label="Commission">{r.meta?.commission_pct != null ? `${r.meta.commission_pct}%` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
