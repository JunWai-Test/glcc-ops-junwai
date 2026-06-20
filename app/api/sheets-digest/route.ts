import { sendMessage } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

// Daily Google-Sheet → Telegram summary. Runs ONLY as a Vercel Cron (08:00 MYT =
// 00:00 UTC, see vercel.json). Reads a "link-view" sheet with a Google API key, so
// no service account is needed. Triggered ONLY by Vercel: the cron sends
// `Authorization: Bearer <CRON_SECRET>`, and we reject anything else.

// Telegram uses HTML parse_mode, so every value pulled from the (untrusted) sheet
// must be escaped before it goes into the message.
function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Parse a cell into a number, tolerating thousands separators / spaces / currency.
function num(v: unknown): number | null {
  const cleaned = String(v ?? '').replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export async function GET(req: Request) {
  // 1) Auth — only Vercel Cron can trigger this (it sends the Bearer secret).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 401 })
  }

  const id = process.env.GOOGLE_SHEET_ID?.trim()
  const range = (process.env.GOOGLE_SHEET_RANGE || 'A:Z').trim()
  const key = process.env.GOOGLE_API_KEY?.trim()
  const owner = process.env.OWNER_CHAT_ID?.trim()
  if (!id || !key) {
    return Response.json({ ok: false, reason: 'missing_env (GOOGLE_SHEET_ID / GOOGLE_API_KEY)' }, { status: 500 })
  }

  // 2) Fetch the tab's rows. (values: string[][], first row = headers.)
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}` +
    `/values/${encodeURIComponent(range)}?key=${encodeURIComponent(key)}`
  let values: string[][] = []
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const msg = body?.error?.message || `HTTP ${res.status}`
      console.error('[GLCC] Sheets fetch failed:', msg)
      if (owner) await sendMessage(owner, `⚠️ <b>Sheet summary failed</b>\nGoogle Sheets API: ${esc(msg)}`)
      return Response.json({ ok: false, reason: 'sheets_error', detail: msg }, { status: 502 })
    }
    values = (await res.json()).values ?? []
  } catch (e) {
    console.error('[GLCC] Sheets fetch threw:', e)
    return Response.json({ ok: false, reason: 'fetch_threw' }, { status: 502 })
  }

  // 3) Build the summary, then 4) send it to the owner.
  const summary = summarize(values)
  if (owner) await sendMessage(owner, summary)
  return Response.json({ ok: true, rows: Math.max(0, values.length - 1), sent: !!owner })
}

// Header-aware default summary — works on ANY sheet, so the pipe is provable today.
// Swap the body for your exact manual rule (e.g. "sum Amount where Status = Paid").
function summarize(values: string[][]): string {
  if (!values.length) return '☀️ <b>Daily sheet summary</b>\n\n(The sheet is empty.)'

  const header = values[0]
  const rows = values.slice(1).filter(r => r.some(c => String(c ?? '').trim() !== ''))
  const out: string[] = ['☀️ <b>Daily sheet summary</b>', `📋 ${rows.length} row${rows.length === 1 ? '' : 's'}`]

  header.forEach((h, c) => {
    const parsed = rows.map(r => num(r[c]))
    const hits = parsed.filter((v): v is number => v !== null)
    // Treat a column as numeric if ≥60% of non-empty cells parse as numbers → show its total.
    const nonEmpty = rows.filter(r => String(r[c] ?? '').trim() !== '').length
    if (nonEmpty > 0 && hits.length >= Math.ceil(nonEmpty * 0.6)) {
      const total = hits.reduce((s, v) => s + v, 0)
      out.push(`• <b>${esc(h || `Col ${c + 1}`)}</b>: ${total.toLocaleString('en-MY')}`)
      return
    }
    // Otherwise, if it's a low-cardinality text column (≤8 distinct), show a breakdown.
    const vals = rows.map(r => String(r[c] ?? '').trim()).filter(Boolean)
    const distinct = new Set(vals)
    if (nonEmpty > 0 && distinct.size > 0 && distinct.size <= 8 && distinct.size < vals.length) {
      const counts = [...distinct].map(v => `${esc(v)}: ${vals.filter(x => x === v).length}`).join(' · ')
      out.push(`• <b>${esc(h || `Col ${c + 1}`)}</b> — ${counts}`)
    }
  })

  return out.join('\n')
}
