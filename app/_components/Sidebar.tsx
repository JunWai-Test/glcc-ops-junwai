'use client'
import { useState } from 'react'
import Nav from './Nav'

// The left sidebar. On desktop it's a static docked column (.side). On mobile it
// becomes a slide-in drawer: a fixed top bar holds the hamburger, tapping it (or
// the scrim) toggles the drawer, and tapping any nav link closes it. All the
// desktop-vs-mobile switching is pure CSS in globals.css — this only owns `open`.
export default function Sidebar() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      {/* Mobile-only top bar (hidden on desktop via CSS). */}
      <header className="topbar">
        <button
          className="hamburger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span /><span /><span />
        </button>
        <div className="brand"><span className="logo" aria-hidden="true" /> Your AI HQ</div>
      </header>

      {/* Tap-outside-to-close backdrop (mobile only). */}
      <div className={`scrim${open ? ' show' : ''}`} onClick={close} aria-hidden="true" />

      <aside className={`side${open ? ' open' : ''}`}>
        <div className="brand"><span className="logo" aria-hidden="true" /> Your AI HQ</div>
        <Nav onNavigate={close} />
        <p className="hint">One <code>records</code> table behind all 8 tabs.</p>
      </aside>
    </>
  )
}
