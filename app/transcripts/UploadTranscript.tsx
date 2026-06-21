'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Small client widget: reads the chosen .txt/.vtt in the browser and POSTs its text
// to /api/upload-transcript (server route, service_role). It never touches the DB
// directly — so the tab page stays a pure server component.
export default function UploadTranscript({ salesmen }: { salesmen: string[] }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [salesman, setSalesman] = useState(salesmen[0] ?? '')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    if (!file) { setMsg('Pick a .txt or .vtt transcript first.'); return }
    setBusy(true); setMsg('Reading & reviewing… (a few seconds)')
    try {
      const text = await file.text()
      const res = await fetch('/api/upload-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-glcc-upload': '1' },
        body: JSON.stringify({
          title: title || file.name.replace(/\.(txt|vtt)$/i, ''),
          salesman,
          text,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.ok) {
        setMsg('✅ Saved & reviewed.')
        setFile(null); setTitle('')
        router.refresh() // re-render the server page so the new review shows
      } else {
        setMsg('Upload failed: ' + (data.reason || res.status))
      }
    } catch {
      setMsg('Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="agent-card" style={{ marginBottom: 18 }}>
      <p className="ac-name">⬆️ Upload a Zoom transcript</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input
          type="file"
          accept=".txt,.vtt,text/plain"
          className="fld"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <select className="fld" value={salesman} onChange={e => setSalesman(e.target.value)}>
          {salesmen.length === 0 && <option value="">(add salesmen first)</option>}
          {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className="fld"
          placeholder="Title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? 'Working…' : 'Upload & review'}
        </button>
      </div>
      {msg && <p className="ac-role" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  )
}
