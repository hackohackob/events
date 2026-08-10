import Image from 'next/image'
import Link from 'next/link'

/** Where to reach a human about anything on these pages. */
export const CONTACT_EMAIL = 'info@academyfirstaid.com'
export const OPERATOR_NAME = 'Academy First Aid'

/**
 * Chrome for the public-facing pages — the legal documents an app store links
 * to, and the APK download page. Deliberately plain and self-contained: these
 * are read by runners, reviewers and app-store staff, not by coordinators.
 */
export default function PublicPage({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker?: string
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen w-full" style={{ background: '#070e1b' }}>
      <header
        className="w-full px-6 py-4"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.1)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Image src="/logo.png" alt="" width={30} height={30} className="flex-shrink-0" />
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-white font-bold text-sm tracking-wide">EXTREME MEDICS</div>
            <div className="text-[11px] font-medium" style={{ color: '#64748b' }}>
              {OPERATOR_NAME}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {kicker && (
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: '#22c55e' }}>
            {kicker}
          </div>
        )}
        <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
        {subtitle && (
          <p className="text-sm mb-8" style={{ color: '#64748b' }}>
            {subtitle}
          </p>
        )}
        {children}
      </main>

      <footer
        className="w-full px-6 py-6 mt-10"
        style={{ borderTop: '1px solid rgba(148,163,184,0.1)' }}
      >
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ color: '#64748b' }}>
          <Link href="/terms" className="hover:text-slate-300 transition-colors">
            Terms &amp; Conditions
          </Link>
          <Link href="/privacy" className="hover:text-slate-300 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/download-apk" className="hover:text-slate-300 transition-colors">
            Download
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-300 transition-colors">
            {CONTACT_EMAIL}
          </a>
          <span className="ml-auto">
            © {new Date().getFullYear()} {OPERATOR_NAME}
          </span>
        </div>
      </footer>
    </div>
  )
}

/** A numbered section of a legal document. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-base font-bold text-white mb-2.5">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
        {children}
      </div>
    </section>
  )
}

/** Bulleted list inside a legal section. */
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="flex-shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: '#22c55e' }} />
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ul>
  )
}
