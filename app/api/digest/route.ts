import { sendMessage } from '@/lib/telegram'
import { getRecords, rm, todayISO, DEAL_CATS, NEW_CATS, type Rec } from '@/lib/records'

export const dynamic = 'force-dynamic'

// The Y step: a Vercel Cron hits this once a day and texts the owner a summary.
// If you set a CRON_SECRET env var, Vercel Cron sends it as a Bearer token and
// this route rejects anyone else. Without it, the route is open (demo-friendly).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 401 })
  }
  const rows = await getRecords()
  const open = rows.filter(r => ['open', 'new', 'contacted', 'pending'].includes(r.status) && !NEW_CATS.includes(r.category ?? '')).length
  const pipeline = rows.filter(r => r.category && DEAL_CATS.includes(r.category) && !['done', 'lost'].includes(r.status)).reduce((s, r) => s + Number(r.amount || 0), 0)
  const today = todayISO()
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
  const relevant = rows.filter(r => r.due_date && r.due_date <= soon && !NEW_CATS.includes(r.category ?? '') && !['done', 'lost'].includes(r.status))
  const overdue = relevant.filter(r => r.due_date! < today)
  const upcoming = relevant.filter(r => r.due_date! >= today)

  const msg =
    `☀️ <b>Daily digest</b>\n` +
    `📦 ${rows.length} records · ${open} open\n` +
    `💰 Pipeline: <b>${rm(pipeline)}</b>\n` +
    (overdue.length ? `\n🔴 <b>Overdue:</b>\n` + overdue.map(r => `• ${r.title} (${r.due_date})`).join('\n') : '') +
    (upcoming.length ? `\n⏳ <b>Due in 3 days:</b>\n` + upcoming.map(r => `• ${r.title} (${r.due_date})`).join('\n') : '') +
    (!overdue.length && !upcoming.length ? `\n✅ Nothing due in the next 3 days.` : '')

  // --- SalesMan section (GLCC add-on): below-target, low-activity & scoreboard ---
  const LOW_CALLS = 20
  const pctTo = (r: Rec) => {
    const t = Number(r.amount || 0)
    return t > 0 ? Math.round((Number(r.meta?.sales || 0) / t) * 100) : 0
  }
  const team = rows.filter(r => r.category === 'salesman')
  let salesMsg = ''
  if (team.length) {
    const below = team.filter(r => pctTo(r) < 50)
    const lowAct = team.filter(r => Number(r.meta?.calls || 0) < LOW_CALLS)
    const board = [...team].sort((a, b) => pctTo(b) - pctTo(a))
    salesMsg =
      `\n\n👔 <b>SalesMan</b>` +
      (below.length ? `\n🔻 <b>Below 50% target:</b>\n` + below.map(r => `• ${r.title} (${pctTo(r)}%)`).join('\n') : '') +
      (lowAct.length ? `\n📞 <b>Low activity (under ${LOW_CALLS} calls):</b>\n` + lowAct.map(r => `• ${r.title} (${Number(r.meta?.calls || 0)} calls)`).join('\n') : '') +
      `\n🏆 <b>Scoreboard:</b>\n` + board.map(r => `• ${r.title} — ${Number(r.meta?.calls || 0)} calls · ${pctTo(r)}%`).join('\n')
  }

  const owner = process.env.OWNER_CHAT_ID?.trim()
  if (owner) await sendMessage(owner, msg + salesMsg)
  return Response.json({ ok: true, sent: !!owner })
}
