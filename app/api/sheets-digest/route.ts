import { sendMessage } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

// Daily Google-Sheet → Telegram monthly-balance summary. Runs ONLY as a Vercel
// Cron (08:00 MYT = 00:00 UTC, see vercel.json). Reads a "link-view" sheet via
// Google's gviz CSV export — NO API key or service account needed. Triggered ONLY
// by Vercel: the cron sends `Authorization: Bearer <CRON_SECRET>`; we reject the rest.

// Telegram uses HTML parse_mode, so every value pulled from the (untrusted) sheet
// must be escaped before it goes into the message.
function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Parse a cell into a number, tolerating "MYR 1,234.50" / "-MYR 1,183.30" etc.
function num(v: unknown): number | null {
  const cleaned = String(v ?? '').replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// Minimal CSV parser — handles quoted fields, embedded commas, and "" escapes.
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export async function GET(req: Request) {
  // 1) Auth — only Vercel Cron can trigger this (it sends the Bearer secret).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 401 })
  }

  const id = process.env.GOOGLE_SHEET_ID?.trim()
  const tab = (process.env.GOOGLE_SHEET_TAB || '').trim()
  const owner = process.env.OWNER_CHAT_ID?.trim()
  if (!id) return Response.json({ ok: false, reason: 'missing_env (GOOGLE_SHEET_ID)' }, { status: 500 })

  // 2) Fetch the tab as CSV — works for any "Anyone with the link" sheet, no key.
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq` +
    `?tqx=out:csv${tab ? `&sheet=${encodeURIComponent(tab)}` : ''}`
  let values: string[][] = []
  try {
    const res = await fetch(url, { redirect: 'follow' })
    const text = await res.text()
    // An HTML response (starts with '<') means the sheet isn't link-viewable / not found.
    if (!res.ok || text.trimStart().startsWith('<')) {
      console.error('[GLCC] Sheet not readable — is it shared "Anyone with the link"?')
      if (owner) {
        await sendMessage(owner, `⚠️ <b>Monthly balance failed</b>\nCouldn't read the sheet — make sure it's shared <i>Anyone with the link → Viewer</i>.`)
      }
      return Response.json({ ok: false, reason: 'not_shared_or_not_found' }, { status: 502 })
    }
    values = parseCSV(text)
  } catch (e) {
    console.error('[GLCC] Sheet fetch threw:', e)
    return Response.json({ ok: false, reason: 'fetch_threw' }, { status: 502 })
  }

  // 3) Build the monthly-balance summary, then 4) send it to the owner.
  const summary = summarize(values)
  if (owner) await sendMessage(owner, summary)
  return Response.json({ ok: true, sent: !!owner })
}

// Monthly balance for the "Money — Fact & Plan" 2026 tab.
// Layout: a row whose column A is a month name (e.g. "JUNE") starts that month's
// block; inside the block, the sheet's own "Balance" row (col B = "Balance") holds
// the net in col C, and the "Total" cell (col E = "Total") holds total spending in
// col F. We read those computed cells so the ping matches what you see — with a
// line-item fallback for any month not totaled yet. Falls back to a generic
// summary if no month blocks are found, so the route never breaks.
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
    const spending = b.totalCell ?? b.spendSum            // prefer the sheet's own Total
    const income = b.incomeSum                            // (sheet prints no income total)
    const balance = b.balanceCell ?? income - spending    // prefer the sheet's own Balance
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
