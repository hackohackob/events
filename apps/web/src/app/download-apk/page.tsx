import type { Metadata } from 'next'
import Link from 'next/link'
import { Apple, Download, ExternalLink, Play, ShieldCheck, Smartphone } from 'lucide-react'
import PublicPage from '@/components/layout/PublicPage'
import {
  RELEASES_URL,
  STABLE_APK_URL,
  fetchLatestApkRelease,
  formatBytes,
  parseReleaseNotes,
} from '@/lib/apk-release'

export const metadata: Metadata = {
  title: 'Download Extreme Medics — Android APK',
  description:
    'Download the latest Extreme Medics responder app for Android, with release notes and install instructions.',
}

/** Re-check GitHub for a new build every two minutes.
 *
 *  Ten was too long for a page whose only job is to name the newest build: a
 *  medic told "download 6.1.2" was still being offered 6.1.1 minutes after it
 *  shipped. Two minutes is 30 API calls an hour, comfortably inside GitHub's
 *  unauthenticated limit of 60. */
export const revalidate = 120

/**
 * Store listings, filled in once the apps are published. `null` renders the
 * button greyed out as "Coming soon" rather than hiding it — an event organiser
 * looking at this page should be able to see that store versions are on the way.
 */
const PLAY_STORE_URL: string | null = null
const APP_STORE_URL: string | null = null

export default async function DownloadApkPage() {
  const release = await fetchLatestApkRelease()
  const notes = release ? parseReleaseNotes(release.notes) : []
  const downloadUrl = release?.downloadUrl ?? STABLE_APK_URL

  return (
    <PublicPage
      kicker="Android"
      title="Download Extreme Medics"
      subtitle="The responder app for medics and event coordinators."
    >
      {/* ── Primary download ── */}
      <div
        className="rounded-2xl p-5 mb-6"
        style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)' }}
      >
        {/* Stacks on a phone — which is where this page is mostly opened. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className="flex items-center justify-center w-12 h-12 rounded-2xl flex-shrink-0"
            style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
          >
            <Smartphone className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-white">
              {release ? `Version ${release.version}` : 'Latest release'}
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
              {release ? (
                <>
                  Android APK · {formatBytes(release.sizeBytes)}
                  {release.publishedAt && (
                    <>
                      {' '}
                      · released{' '}
                      {new Date(release.publishedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </>
                  )}
                </>
              ) : (
                'Always serves the most recent build'
              )}
            </div>
          </div>
          <a
            href={downloadUrl}
            className="flex items-center justify-center gap-2 w-full sm:w-auto flex-shrink-0 px-5 py-3 rounded-xl text-sm font-bold transition-transform hover:scale-[1.02]"
            style={{ background: '#22c55e', color: '#04121f' }}
          >
            <Download className="w-4 h-4" />
            Download APK
          </a>
        </div>
      </div>

      {/* ── Store links (filled in on publication) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <StoreButton
          href={PLAY_STORE_URL}
          icon={<Play className="w-5 h-5" />}
          label="Google Play"
          sub={PLAY_STORE_URL ? 'Install for Android' : 'Coming soon'}
        />
        <StoreButton
          href={APP_STORE_URL}
          icon={<Apple className="w-5 h-5" />}
          label="App Store"
          sub={APP_STORE_URL ? 'Install for iPhone' : 'Coming soon'}
        />
      </div>

      {/* ── What's in this release ── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-white mb-3">What&rsquo;s in this release</h2>
        {notes.length > 0 ? (
          <div
            className="rounded-2xl px-5 py-4 space-y-2"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}
          >
            {notes.map((line, i) =>
              line.kind === 'heading' ? (
                <div
                  key={i}
                  className="text-[11px] font-bold uppercase tracking-widest pt-1"
                  style={{ color: '#64748b' }}
                >
                  {line.text}
                </div>
              ) : line.kind === 'bullet' ? (
                <div key={i} className="flex gap-2.5 text-sm" style={{ color: '#cbd5e1' }}>
                  <span
                    className="flex-shrink-0 mt-[7px] w-1 h-1 rounded-full"
                    style={{ background: '#22c55e' }}
                  />
                  <span className="flex-1">{line.text}</span>
                </div>
              ) : (
                <p key={i} className="text-sm" style={{ color: '#cbd5e1' }}>
                  {line.text}
                </p>
              ),
            )}
          </div>
        ) : (
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            Release notes for this build are on the{' '}
            <a
              href={release?.releaseUrl ?? RELEASES_URL}
              className="inline-flex items-center gap-1"
              style={{ color: '#22c55e' }}
            >
              releases page <ExternalLink className="w-3 h-3" />
            </a>
            .
          </p>
        )}
      </section>

      {/* ── Install instructions ── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-white mb-3">Installing</h2>
        <ol className="space-y-2.5">
          {[
            'Open this page on the Android phone you want to install on, and tap Download APK.',
            'Android will warn that the file can be harmful — that warning appears for every app installed outside the Play Store. Choose Download anyway.',
            'Open the downloaded file. If prompted, allow your browser to install unknown apps, then return and confirm the install.',
            'Open Extreme Medics and sign in with the account your event coordinator gave you.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-sm" style={{ color: '#cbd5e1' }}>
              <span
                className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold mt-0.5"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
              >
                {i + 1}
              </span>
              <span className="flex-1">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Permissions note ── */}
      <div
        className="rounded-2xl px-4 py-3.5 mb-8 flex gap-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}
      >
        <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
        <div className="text-sm" style={{ color: '#cbd5e1' }}>
          <div className="font-semibold text-white mb-1">Why it asks for background location</div>
          The app has to keep reporting your position while your screen is off, so Race Command can
          dispatch you and find you. It only does this while an event is active and you are on duty.
          See the{' '}
          <Link href="/privacy" style={{ color: '#22c55e' }}>
            Privacy Policy
          </Link>{' '}
          for exactly what is collected and how long it is kept.
        </div>
      </div>

      <p className="text-xs" style={{ color: '#64748b' }}>
        Every build is also listed, with checksums and older versions, on the{' '}
        <a href={RELEASES_URL} style={{ color: '#94a3b8' }}>
          GitHub releases page
        </a>
        . The permanent link{' '}
        <code style={{ color: '#94a3b8' }}>/download-apk/latest</code> always redirects to the newest
        APK.
      </p>
    </PublicPage>
  )
}

function StoreButton({
  href,
  icon,
  label,
  sub,
}: {
  href: string | null
  icon: React.ReactNode
  label: string
  sub: string
}) {
  const inner = (
    <>
      <span className="flex-shrink-0" style={{ color: href ? '#e2e8f0' : '#475569' }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0 text-left">
        <span className="block text-sm font-bold" style={{ color: href ? '#e2e8f0' : '#64748b' }}>
          {label}
        </span>
        <span className="block text-[11px]" style={{ color: '#64748b' }}>
          {sub}
        </span>
      </span>
    </>
  )

  const style = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(148,163,184,0.14)',
    opacity: href ? 1 : 0.55,
  }

  if (!href) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-not-allowed" style={style}>
        {inner}
      </div>
    )
  }
  return (
    <a
      href={href}
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:brightness-125"
      style={style}
    >
      {inner}
    </a>
  )
}
