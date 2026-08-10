import type { Metadata } from 'next'
import Link from 'next/link'
import PublicPage, { CONTACT_EMAIL, LegalList, LegalSection, OPERATOR_NAME } from '@/components/layout/PublicPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — Extreme Medics',
  description:
    'How Academy First Aid collects, uses and protects personal data in the Extreme Medics responder app, the Runner Companion app and the coordinator console.',
}

const LAST_UPDATED = '10 August 2026'

/** What we collect, why, and on what basis — the table store reviewers look for. */
const DATA_TABLE: Array<{ what: string; why: string; basis: string }> = [
  {
    what: 'Identity and contact — name, email address, phone number, role, unit, profile photo where provided',
    why: 'To create your account, show responders who is who, and let Race Command reach you',
    basis: 'Performance of a contract (Art. 6(1)(b))',
  },
  {
    what: 'Event participation — BIB/registration number, assigned track, vehicle type, on-duty status',
    why: 'To place you on the right event and route the right responder to you',
    basis: 'Performance of a contract (Art. 6(1)(b))',
  },
  {
    what: 'Precise location — GPS position, accuracy, speed and heading, collected in the background while an event is active and you are on duty or opted in',
    why: 'So responders can find you, estimate arrival times and coordinate cover across the course',
    basis: 'Performance of a contract (Art. 6(1)(b)); vital interests in an emergency (Art. 6(1)(d))',
  },
  {
    what: 'Device status — battery level and charging state',
    why: 'So Race Command can tell a stationary medic from a dead phone',
    basis: 'Legitimate interests (Art. 6(1)(f)) — reliable safety cover',
  },
  {
    what: 'Health data — allergies, medications, blood type, pre-existing conditions, and the content of incident reports',
    why: 'So a responder arrives knowing what they are treating',
    basis: 'Explicit consent (Art. 9(2)(a)); vital interests where you cannot give consent (Art. 9(2)(c))',
  },
  {
    what: 'Incident content — photographs, voice messages, chat messages, and the transcripts of voice messages',
    why: 'To report, triage and coordinate a response, and to review incidents afterwards',
    basis: 'Performance of a contract (Art. 6(1)(b)); vital interests (Art. 6(1)(d))',
  },
  {
    what: 'Technical data — push notification token, app version, device platform, diagnostic logs',
    why: 'To deliver alerts, ship updates and diagnose faults',
    basis: 'Legitimate interests (Art. 6(1)(f)) — a working, secure service',
  },
]

const SUBPROCESSORS: Array<{ name: string; role: string; where: string }> = [
  { name: 'Hetzner / VPS hosting', role: 'Application, database and uploaded media hosting', where: 'EU' },
  { name: 'Expo (EAS Update & Push)', role: 'Application updates and push notification delivery', where: 'USA' },
  { name: 'Google (Firebase Cloud Messaging, Maps SDK)', role: 'Android push delivery and map rendering', where: 'USA / EU' },
  { name: 'Apple (APNs)', role: 'iOS push notification delivery', where: 'USA / EU' },
  { name: 'Seznam.cz (Mapy.cz)', role: 'Map tiles and terrain', where: 'EU' },
  { name: 'OpenStreetMap Foundation', role: 'Map tiles and map data', where: 'EU' },
  { name: 'Soniox', role: 'Speech-to-text for voice messages', where: 'USA' },
  { name: 'OpenAI', role: 'Speech-to-text fallback when the primary provider is unavailable', where: 'USA' },
  { name: 'Open-Meteo', role: 'Weather overlays (no personal data sent)', where: 'EU' },
  { name: 'Zello', role: 'Optional push-to-talk radio bridge, where an Organiser enables it', where: 'USA' },
]

export default function PrivacyPage() {
  return (
    <PublicPage kicker="Legal" title="Privacy Policy" subtitle={`Last updated: ${LAST_UPDATED}`}>
      <p className="text-sm leading-relaxed mb-8" style={{ color: '#cbd5e1' }}>
        This policy explains how <strong>{OPERATOR_NAME}</strong> (“we”, “us”), the controller of
        your personal data, collects and uses information in the <strong>Extreme Medics</strong>{' '}
        responder app, the <strong>Runner Companion</strong> participant app and the coordinator
        console (together, the “Service”). It should be read alongside our{' '}
        <Link href="/terms" style={{ color: '#22c55e' }}>
          Terms &amp; Conditions
        </Link>
        .
      </p>

      <div
        className="rounded-2xl px-4 py-3.5 mb-8 text-sm"
        style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.25)',
          color: '#bbf7d0',
        }}
      >
        <strong>In short:</strong> we collect your location and, if you provide it, your medical
        information, so that a medic can reach you and treat you at an event. We share it with that
        event’s safety team and nobody else. We never sell it or use it for advertising, and we
        delete it when the event and any incident review are over.
      </div>

      <LegalSection title="1. What we collect and why">
        <div className="space-y-3">
          {DATA_TABLE.map((row, i) => (
            <div
              key={i}
              className="rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <div className="text-sm font-semibold text-white mb-1.5">{row.what}</div>
              <div className="text-xs mb-1" style={{ color: '#cbd5e1' }}>
                <span style={{ color: '#64748b' }}>Why: </span>
                {row.why}
              </div>
              <div className="text-xs" style={{ color: '#94a3b8' }}>
                <span style={{ color: '#64748b' }}>Lawful basis: </span>
                {row.basis}
              </div>
            </div>
          ))}
        </div>
      </LegalSection>

      <LegalSection title="2. Background location">
        <p>
          The Extreme Medics app collects location <strong>in the background</strong> — that is,
          while the app is not on screen and the device is locked. This is the core safety function:
          a medic on duty must be findable and dispatchable without having to hold their phone, and
          a participant who has reported an incident must remain findable while they wait.
        </p>
        <p>
          Background collection runs only while an event is active and you are on duty or have opted
          in, and the app shows a permanent notification while it is doing so. You can revoke the
          permission at any time in your device settings; the Service will then be unable to locate
          you.
        </p>
      </LegalSection>

      <LegalSection title="3. Who your data is shared with">
        <p>
          Within an event, your data is visible to <strong>Race Command</strong>, to{' '}
          <strong>medics assigned to your incident</strong>, and to the <strong>Organiser</strong>,
          strictly for the purpose of event safety. Other participants cannot see your position or
          your medical information.
        </p>
        <p>
          We use the following sub-processors to run the Service. Transfers outside the EEA are made
          under the European Commission’s Standard Contractual Clauses or an adequacy decision.
        </p>
        <div className="space-y-1.5 mt-1">
          {SUBPROCESSORS.map(s => (
            <div
              key={s.name}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 text-xs"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <span className="font-semibold text-white">{s.name}</span>
              <span style={{ color: '#94a3b8' }}>— {s.role}</span>
              <span className="ml-auto" style={{ color: '#64748b' }}>
                {s.where}
              </span>
            </div>
          ))}
        </div>
        <p>
          We do <strong>not</strong> sell your personal data, share it with data brokers, or use it
          for advertising or profiling. We may disclose data where we are legally required to, or to
          establish, exercise or defend legal claims.
        </p>
      </LegalSection>

      <LegalSection title="4. How long we keep it">
        <LegalList
          items={[
            <>
              <strong>Live location</strong> — kept for the duration of the event and for up to{' '}
              <strong>30 days</strong> afterwards for incident review and safety auditing, then
              deleted or anonymised.
            </>,
            <>
              <strong>Incident records, photos, voice messages and transcripts</strong> — kept for
              up to <strong>12 months</strong>, or longer where needed to comply with a legal
              obligation or to establish, exercise or defend a legal claim.
            </>,
            <>
              <strong>Medical information</strong> — kept for the duration of your participation and
              deleted when your account is deleted, or when the event closes if it was supplied for
              a single event.
            </>,
            <>
              <strong>Account and contact details</strong> — kept while your account is active and
              deleted within 30 days of your account being deleted.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Your rights">
        <p>
          Under the GDPR you have the right to access your personal data, to have it corrected or
          erased, to restrict or object to its processing, to receive it in a portable format, and
          to withdraw consent at any time (without affecting processing carried out before
          withdrawal). Health data is processed on the basis of your explicit consent, which you can
          withdraw by removing it in the app or by contacting us.
        </p>
        <p>
          To exercise any of these rights, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#22c55e' }}>
            {CONTACT_EMAIL}
          </a>
          . We respond within one month. You also have the right to lodge a complaint with your
          local supervisory authority — in Bulgaria, the Commission for Personal Data Protection
          (CPDP).
        </p>
      </LegalSection>

      <LegalSection title="6. Deleting your account and data">
        <p>
          You can request deletion of your account and all associated personal data at any time,
          either from the app’s settings screen or by emailing{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#22c55e' }}>
            {CONTACT_EMAIL}
          </a>{' '}
          from the address on your account. We delete your profile, location history, medical
          information and incident content within 30 days.
        </p>
        <p>
          Incident records that another person reported, or that we are required to retain by law,
          may be kept in a form that no longer identifies you.
        </p>
      </LegalSection>

      <LegalSection title="7. Security">
        <p>
          Data is transmitted over TLS and stored on access-controlled servers in the EU. Access to
          personal and health data is limited to the event staff who need it for their safety role
          and to a small number of administrators. Uploaded photos and audio are stored on our own
          infrastructure, not in a public bucket.
        </p>
        <p>
          No system is perfectly secure. If a breach occurs that is likely to result in a risk to
          your rights, we will notify the supervisory authority within 72 hours and inform you where
          required.
        </p>
      </LegalSection>

      <LegalSection title="8. Children">
        <p>
          The Service is not directed at children under 16. Where a participant under that age takes
          part in an event, their parent or guardian must provide any medical information and
          consent on their behalf.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to this policy">
        <p>
          We may update this policy. The “Last updated” date above reflects the current version, and
          we will bring material changes to your attention in the app where practicable.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          {OPERATOR_NAME} — data protection enquiries:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#22c55e' }}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </PublicPage>
  )
}
