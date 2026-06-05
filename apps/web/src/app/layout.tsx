import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/layout/Sidebar'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'Paramedic Event App',
  description: 'Event management for medical response teams',
  icons: { icon: '/logo.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="flex min-h-screen" style={{ background: '#070e1b' }}>
            <Sidebar />
            <main className="flex-1 ml-0 lg:ml-[200px] min-h-screen flex flex-col min-w-0">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
