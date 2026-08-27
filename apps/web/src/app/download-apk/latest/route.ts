import { NextResponse } from 'next/server'
import { STABLE_APK_URL } from '@/lib/apk-release'

/**
 * Permanent download URL on our own domain:
 * `https://events.academyfirstaid.com/download-apk/latest`
 *
 * Handed out on QR codes and printed briefing sheets, which cannot be reissued
 * when the app ships — so this must never be able to go stale.
 *
 * It redirects to GitHub's own `releases/latest/download/...` alias, which
 * GitHub resolves at request time. It used to call the API first to name the
 * versioned asset, which put a ten-minute Data Cache between a release and this
 * link: minutes after 6.1.2 shipped, this URL was still handing out 6.1.1.
 * Nothing about a permanent link needs an API call, so it no longer makes one —
 * which also takes it off GitHub's unauthenticated rate limit entirely.
 *
 * No caching directive on purpose: the handler is a constant redirect with no
 * I/O, so running it per request costs nothing, and there is no cache left that
 * could hold an old version.
 */
export async function GET() {
  return NextResponse.redirect(STABLE_APK_URL, 302)
}
