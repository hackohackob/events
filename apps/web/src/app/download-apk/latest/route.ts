import { NextResponse } from 'next/server'
import { STABLE_APK_URL, fetchLatestApkRelease } from '@/lib/apk-release'

/** Re-resolve the newest build every 10 minutes. */
export const revalidate = 600

/**
 * Permanent download URL on our own domain:
 * `https://events.academyfirstaid.com/download-apk/latest`
 *
 * Redirects to the newest APK on the GitHub release. Handy for QR codes and
 * printed briefing sheets, which cannot be reissued every time the app ships.
 */
export async function GET() {
  const release = await fetchLatestApkRelease()
  return NextResponse.redirect(release?.downloadUrl ?? STABLE_APK_URL, 302)
}
