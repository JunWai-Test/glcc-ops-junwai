import './globals.css'
import Sidebar from './_components/Sidebar'
import ConnStatus from './_components/ConnStatus'

export const metadata = {
  title: 'Your AI HQ',
  description: 'GLCC Starter — your business in one place',
}

// width=device-width + initial-scale=1 stops iOS from zooming; viewportFit cover
// lets the fixed top bar pad around the notch/home bar via env(safe-area-inset-*).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <Sidebar />
          <main className="main"><ConnStatus />{children}</main>
        </div>
      </body>
    </html>
  )
}
