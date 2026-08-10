'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

/**
 * Routes that are shown to the public rather than to coordinators — the legal
 * pages an app store links to, and the APK download page. They render without
 * the operator sidebar: a runner following a Play Store link has no business
 * seeing (or being offered) the event console's navigation.
 */
const PUBLIC_ROUTES = ['/terms', '/privacy', '/download-apk']

export function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (isPublicRoute(pathname)) {
    return <main className="flex-1 min-h-screen flex flex-col min-w-0">{children}</main>
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 ml-0 lg:ml-[200px] min-h-screen flex flex-col min-w-0">{children}</main>
    </>
  )
}
