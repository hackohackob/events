import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/layout/AppShell'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'Medic Event App',
  description: 'Event management for medical response teams',
  icons: { icon: '/logo.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="flex min-h-screen" style={{ background: '#070e1b' }}>
            <AppShell>{children}</AppShell>
          </div>
        </Providers>
      </body>
    </html>
  )
}
