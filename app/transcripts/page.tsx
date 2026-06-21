import { getRecords, m } from '@/lib/records'
import UploadTranscript from './UploadTranscript'

export const dynamic = 'force-dynamic'

// Zoom call transcripts → per-salesman AI call review. category === 'transcript'.
// Custom fields in meta: salesman, score (0-10), review (text), date.
export default async function Transcripts() {
  const all = await getRecords()
  const rows = all.filter(r => r.category === 'transcript')
  const salesmen = Array.from(new Set(all.filter(r => r.category === 'salesman').map(r => r.title)))

  const scores = rows.map(r => Number(r.meta?.score)).filter(n => !Number.isNaN(n))
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null

  const cards: [string, string | number][] = [
    ['Transcripts', rows.length],
    ['Avg score', avg ? `${avg}/10` : '—'],
    ['Reps reviewed', new Set(rows.map(r => r.meta?.salesman).filter(Boolean)).size],
  ]

  return (
    <>
      <h1 className="ph">Transcripts</h1>
      <p className="cap">Upload Zoom calls — Claude reviews each rep</p>
      <div className="grid">
        {cards.map(([l, v]) => (
          <div className="stat" key={l}><p className="l">{l}</p><p className="v">{v}</p></div>
        ))}
      </div>

      <UploadTranscript salesmen={salesmen} />

      {rows.length === 0 ? (
        <p className="empty">No transcripts yet — upload a Zoom <code>.txt</code> or <code>.vtt</code> above.</p>
      ) : (
        rows.map(r => (
          <div className="agent-card" key={r.id} style={{ marginBottom: 14 }}>
            <p className="ac-name">
              📝 {r.title}
              {r.meta?.score != null && <span className="tag proactive">{r.meta.score}/10</span>}
            </p>
            <p className="ac-role">👤 {m(r, 'salesman')} · {m(r, 'date')}</p>
            <pre className="brief">{m(r, 'review')}</pre>
          </div>
        ))
      )}
    </>
  )
}
