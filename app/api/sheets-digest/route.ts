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
    `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&key=${encodeURIComponent(key)}`
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

// Monthly balance for the "Money — Fact & Plan" 2026 tab.
// Layout: a row whose column A is a month name (e.g. "JUNE") starts that month's
// block; inside the block, column C holds income amounts and column F holds
// spending amounts. Balance = income − spending. Falls back to a generic summary
// if no month blocks are found, so the route never breaks.
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function summarize(values: string[][]): string {
  type Block = {
    month: string
    balanceCell: number | null // the sheet's own "Balance" cell (col C of the Balance row)
    totalCell: number | null   // the sheet's own "Total" spending cell (col F of the same row)
    incomeSum: number          // fallback: summed income line items (col C)
    spendSum: number           // fallback: summed spending line items (col F)
  }
  const blocks: Block[] = []
  let cur: Block | null = null

  for (const row of values) {
    const month = String(row[0] ?? '').trim()
    if (MONTHS.includes(month.toLowerCase())) {
      cur = { month, balanceCell: null, totalCell: null, incomeSum: 0, spendSum: 0 }
      blocks.push(cur)
      continue
    }
    if (!cur) continue
    const labelB = String(row[1] ?? '').trim().toLowerCase() // income-column label
    const labelE = String(row[4] ?? '').trim().toLowerCase() // spending-column label

    // Read the sheet's own summary cells; otherwise accumulate line items as a fallback.
    if (labelB === 'balance') cur.balanceCell = num(row[2])
    else if (labelB !== 'income') { const v = num(row[2]); if (v) cur.incomeSum += v }

    if (labelE === 'total') cur.totalCell = num(row[5])
    else if (labelE !== 'spending') { const v = num(row[5]); if (v) cur.spendSum += v }
  }

  if (!blocks.length) return genericSummary(values)

  const fmt = (n: number) =>
    'MYR ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const out: string[] = ['💰 <b>Monthly balance — 2026</b>', '']
  for (const b of blocks) {
    const spending = b.totalCell ?? b.spendSum                 // prefer the sheet's Total
    const income = b.incomeSum                                 // (sheet prints no income total)
    const balance = b.balanceCell ?? income - spending         // prefer the sheet's Balance
    const sign = balance >= 0 ? '🟢' : '🔴'
    out.push(
      `${sign} <b>${esc(b.month)}</b> — Balance <b>${fmt(balance)}</b>\n` +
      `   <i>Income ${fmt(income)} · Spending ${fmt(spending)}</i>`,
    )
  }
  return out.join('\n')
}

// Generic fallback (header-aware) — used only if the month layout isn't detected.
function genericSummary(values: string[][]): string {
  if (!values.length) return '☀️ <b>Daily sheet summary</b>\n\n(The sheet is empty.)'
  const header = values[0]
  const rows = values.slice(1).filter(r => r.some(c => String(c ?? '').trim() !== ''))
  const out: string[] = ['☀️ <b>Daily sheet summary</b>', `📋 ${rows.length} row${rows.length === 1 ? '' : 's'}`]
  header.forEach((h, c) => {
    const hits = rows.map(r => num(r[c])).filter((v): v is number => v !== null)
    const nonEmpty = rows.filter(r => String(r[c] ?? '').trim() !== '').length
    if (nonEmpty > 0 && hits.length >= Math.ceil(nonEmpty * 0.6)) {
      out.push(`• <b>${esc(h || `Col ${c + 1}`)}</b>: ${hits.reduce((s, v) => s + v, 0).toLocaleString('en-MY')}`)
    }
  })
  return out.join('\n')
}
