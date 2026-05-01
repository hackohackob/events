import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/layout/Sidebar'

export const metadata: Metadata = {
  title: 'Paramedic Event App',
  description: 'Event management for medical response teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen" style={{ background: '#070e1b' }}>
          <Sidebar />
          <main className="flex-1 ml-[200px] min-h-screen flex flex-col">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
