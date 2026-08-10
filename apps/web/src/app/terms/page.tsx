import type { Metadata } from 'next'
import Link from 'next/link'
import PublicPage, { CONTACT_EMAIL, LegalList, LegalSection, OPERATOR_NAME } from '@/components/layout/PublicPage'

export const metadata: Metadata = {
  title: 'Terms & Conditions — Extreme Medics',
  description:
    'Terms and Conditions for the Extreme Medics event safety platform, the Extreme Medics responder app and the Runner Companion app.',
}

/** Last substantive revision. Keep in step with apps/runner/src/screens/terms-content.ts. */
const LAST_UPDATED = '10 August 2026'

export default function TermsPage() {
  return (
    <PublicPage
      kicker="Legal"
      title="Terms & Conditions"
      subtitle={`Last updated: ${LAST_UPDATED}`}
    >
      <div
        className="rounded-2xl px-4 py-3.5 mb-8 text-sm font-semibold"
        style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5',
        }}
      >
        The Service is an aid to event safety only. It does <strong>not</strong> replace your local
        emergency services. In any life-threatening situation, call <strong>112</strong> (or your
        local emergency number) immediately.
      </div>

      <p className="text-sm leading-relaxed mb-8" style={{ color: '#cbd5e1' }}>
        These Terms &amp; Conditions (the “<strong>Terms</strong>”) form a binding agreement between
        you (“<strong>you</strong>”, the “<strong>Participant</strong>”, the “<strong>Medic</strong>”
        or the “<strong>User</strong>”) and <strong>{OPERATOR_NAME}</strong>, the operator of the
        Extreme Medics event safety platform (the “<strong>Service</strong>”, “<strong>we</strong>”,
        “<strong>us</strong>” or “<strong>our</strong>”). The Service is provided to support
        on-course safety and emergency medical coordination at organised sporting events. By
        creating a profile, joining an event, or otherwise using the Service, you confirm that you
        have read, understood and agree to be bound by these Terms and by our{' '}
        <Link href="/privacy" style={{ color: '#22c55e' }}>
          Privacy Policy
        </Link>
        . If you do not agree, do not use the Service.
      </p>

      <LegalSection title="1. What the Service is">
        <p>The Service consists of:</p>
        <LegalList
          items={[
            <>
              <strong>Extreme Medics</strong> — the responder application used by medics and event
              coordinators, available for Android and iOS;
            </>,
            <>
              <strong>Runner Companion</strong> — the participant application used by runners and
              other event participants to call for help and follow the course;
            </>,
            <>
              the <strong>coordinator console</strong>, a web application used by Race Command to
              run an event.
            </>,
          ]}
        />
        <p>
          “<strong>Event</strong>” means an organised race, course or activity that has enabled the
          Service. “<strong>Race Command</strong>” means the event’s medical and safety coordination
          team. “<strong>Organiser</strong>” means the legal entity responsible for the Event.
          “<strong>Content</strong>” means any data you submit, including incident reports, location
          data, medical information, photos, voice messages and chat messages.
        </p>
      </LegalSection>

      <LegalSection title="2. Eligibility and accounts">
        <p>
          You must be at least 16 years old, or the age of digital consent in your jurisdiction, to
          use the Service. If you are under that age, a parent or guardian must accept these Terms
          on your behalf. Responder accounts are issued by Race Command or the Organiser and are
          personal to you.
        </p>
        <p>
          You agree to provide accurate registration and medical information and to keep it up to
          date. You are responsible for activity that occurs under your profile and for keeping any
          access credentials confidential. Tell us or Race Command immediately if you believe your
          account has been used without your permission.
        </p>
      </LegalSection>

      <LegalSection title="3. The Service is not emergency medical care">
        <p>
          The Service is a communications and coordination tool. It does not provide medical advice,
          diagnosis or treatment, and it is not a substitute for professional emergency services,
          telephone emergency lines, or on-site first aid.
        </p>
        <p>
          Response times, medic availability, and the accuracy of any positioning, routing or
          estimated-arrival information cannot be guaranteed. They depend on factors outside our
          control, including network coverage, GPS accuracy, device battery, terrain, map data
          quality and Event staffing. Estimated arrival times are model-based estimates, not
          commitments. <strong>Never rely solely on the Service in an emergency.</strong>
        </p>
      </LegalSection>

      <LegalSection title="4. Location data and how it is used">
        <p>
          When you join an Event, the Service collects your device’s geolocation — including in the
          background while the Event is active, if you grant that permission — and shares it with
          Race Command and assigned medics. This enables responders to find you, to estimate arrival
          times, and to direct help to the right place. Your live position is visible to the Event’s
          authorised safety personnel for the duration of the Event.
        </p>
        <p>
          You can disable location sharing at any time through your device settings, but doing so
          will limit or prevent the Service’s safety features from working — including the ability
          of a medic to find you if you report an incident. Full detail of what is collected and how
          long it is kept is in the{' '}
          <Link href="/privacy" style={{ color: '#22c55e' }}>
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="5. Incident reports and acceptable use">
        <p>You agree that you will not:</p>
        <LegalList
          items={[
            'submit false, misleading or malicious incident reports, or trigger false alarms;',
            'impersonate another participant, medic or official;',
            'upload unlawful, offensive or infringing Content;',
            'use, share or export another person’s medical or location data for any purpose other than responding to an incident at the Event;',
            'interfere with, overload, reverse-engineer, or attempt to gain unauthorised access to the Service or its infrastructure;',
            'use the Service for any purpose other than your own participation, duties or safety at the Event.',
          ]}
        />
        <p>
          Medics and coordinators are given access to other people’s personal and health data
          strictly to carry out their safety role. Treat it as confidential, use it only for that
          purpose, and do not retain copies after the Event.
        </p>
      </LegalSection>

      <LegalSection title="6. Privacy and data protection">
        <p>
          We process personal data in accordance with the EU General Data Protection Regulation
          (GDPR) and applicable national law. Our{' '}
          <Link href="/privacy" style={{ color: '#22c55e' }}>
            Privacy Policy
          </Link>{' '}
          explains what we collect, why, on what lawful basis, who receives it, how long we keep it,
          and how to exercise your rights — including deleting your account and data.
        </p>
      </LegalSection>

      <LegalSection title="7. Third-party services">
        <p>
          The Service relies on third-party providers for mapping and map tiles, route calculation,
          weather, speech transcription, push notifications and application delivery, and on mobile
          platform services for location and notifications. Your use of those features may also be
          subject to the relevant third party’s terms. We are not responsible for the availability
          or accuracy of third-party data. The current list is in the Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="8. Intellectual property">
        <p>
          The Service, including its software, design, trademarks and content (excluding your
          Content), is owned by us or our licensors and is protected by intellectual-property laws.
          We grant you a limited, personal, non-exclusive, non-transferable and revocable licence to
          use the Service for participating in, or working at, an Event.
        </p>
        <p>
          You retain ownership of your Content but grant us a licence to host, process and transmit
          it as necessary to operate the Service and provide the safety functions described in these
          Terms.
        </p>
      </LegalSection>

      <LegalSection title="9. Software updates">
        <p>
          The applications update themselves over the air. We may deliver fixes and improvements
          automatically, and may require a minimum version in order to keep the Service safe and
          interoperable. Continued use after an update constitutes acceptance of that version.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimers">
        <p>
          To the maximum extent permitted by law, the Service is provided “as is” and “as
          available”, without warranties of any kind, whether express or implied, including
          warranties of merchantability, fitness for a particular purpose, accuracy, reliability,
          uninterrupted availability or non-infringement. We do not warrant that the Service will be
          error-free, secure, or available at all times, or that location, routing or timing
          information will be accurate.
        </p>
      </LegalSection>

      <LegalSection title="11. Limitation of liability">
        <p>
          Nothing in these Terms excludes or limits our liability for death or personal injury
          caused by our negligence, for fraud, or for any other liability that cannot be excluded
          under applicable law.
        </p>
        <p>
          Subject to that, to the maximum extent permitted by law we are not liable for any
          indirect, incidental, special, consequential or punitive damages, or for any loss arising
          from your reliance on the Service in an emergency, from delayed or failed responses, from
          inaccurate positioning, or from network, device or third-party failures. Where liability
          cannot be wholly excluded, our total aggregate liability arising out of or in connection
          with the Service is limited to the amount (if any) you paid to use it.
        </p>
      </LegalSection>

      <LegalSection title="12. Indemnity">
        <p>
          You agree to indemnify and hold us, the Organiser and Race Command harmless from any
          claims, losses, liabilities and reasonable expenses arising out of your breach of these
          Terms, your misuse of the Service, or your submission of false or unlawful Content.
        </p>
      </LegalSection>

      <LegalSection title="13. Suspension and termination">
        <p>
          We or the Organiser may suspend or terminate your access to the Service at any time, with
          or without notice, if you breach these Terms or if necessary to protect the safety or
          integrity of the Event. You may stop using the Service at any time and may request
          deletion of your account as described in the Privacy Policy.
        </p>
        <p>
          Sections that by their nature should survive termination (including those on privacy,
          intellectual property, disclaimers, liability and governing law) will continue to apply.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes to these Terms">
        <p>
          We may update these Terms from time to time. The “Last updated” date above reflects the
          latest version. Material changes will be brought to your attention where practicable.
          Continued use of the Service after changes take effect constitutes acceptance of the
          revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="15. Governing law and contact">
        <p>
          These Terms are governed by the laws of the Republic of Bulgaria, without regard to
          conflict-of-laws rules, and the competent Bulgarian courts have exclusive jurisdiction —
          subject to any non-waivable consumer-protection rights you have under the law of your
          country of residence.
        </p>
        <p>
          For questions about these Terms, to exercise your data-protection rights, or to report a
          problem, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#22c55e' }}>
            {CONTACT_EMAIL}
          </a>
          , or speak to the Organiser or Race Command for your Event.
        </p>
      </LegalSection>

      <p className="text-sm leading-relaxed mt-9 pt-6" style={{ color: '#94a3b8', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
        By using the Service you acknowledge that you have read and understood these Terms and our
        Privacy Policy and agree to them.
      </p>
    </PublicPage>
  )
}
