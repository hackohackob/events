import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";

/** Last substantive revision of this document. */
const LAST_UPDATED = "21 June 2026";

export function Terms() {
  const navigate = useNavigate();
  const { t } = useT();
  return (
    <div className="screen" style={{ padding: "44px 18px 40px", maxWidth: 560, margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14 }}>
        {t("terms.back")}
      </button>

      <h1 className="archivo" style={{ fontWeight: 800, fontSize: 24, margin: "16px 0 4px" }}>
        Terms &amp; Conditions
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: 12.5, margin: "0 0 18px" }}>
        Last updated: {LAST_UPDATED}
      </p>

      <p style={lead}>
        These Terms &amp; Conditions (the “<strong>Terms</strong>”) form a binding agreement between you
        (“<strong>you</strong>”, the “<strong>Participant</strong>” or “<strong>User</strong>”) and the operator of the
        Paramedic Event platform (the “<strong>Service</strong>”, “<strong>we</strong>”, “<strong>us</strong>” or
        “<strong>our</strong>”). The Service is provided to support on-course safety and emergency medical coordination
        at organised sporting events. By creating a profile, joining an event, or otherwise using the Service, you
        confirm that you have read, understood and agree to be bound by these Terms and by our Privacy Notice set out
        below. If you do not agree, do not use the Service.
      </p>

      <Banner>
        ⚠️ The Service is an aid to event safety only. It does <strong>not</strong> replace your local emergency
        services. In any life-threatening situation, call <strong>112</strong> (or your local emergency number)
        immediately.
      </Banner>

      <Section n="1" title="Definitions">
        <p style={p}>
          “<strong>Event</strong>” means an organised race, course or activity that has enabled the Service.
          “<strong>Race Command</strong>” means the event’s medical and safety coordination team. “<strong>Medic</strong>”
          means a responder authorised by Race Command. “<strong>Content</strong>” means any data you submit, including
          incident reports, location data, medical information, photos and messages. “<strong>Organiser</strong>” means
          the legal entity responsible for the Event.
        </p>
      </Section>

      <Section n="2" title="Eligibility & accounts">
        <p style={p}>
          You must be at least 16 years old, or the age of digital consent in your jurisdiction, to use the Service. If
          you are under that age, a parent or guardian must accept these Terms on your behalf. You agree to provide
          accurate registration and medical information and to keep it up to date. You are responsible for activity that
          occurs under your profile and for keeping any access credentials confidential.
        </p>
      </Section>

      <Section n="3" title="The Service is not emergency medical care">
        <p style={p}>
          The Service is a communications and coordination tool. It does not provide medical advice, diagnosis or
          treatment, and it is not a substitute for professional emergency services, telephone emergency lines, or
          on-site first aid. Response times, Medic availability, and the accuracy of any positioning or routing
          information cannot be guaranteed and depend on factors outside our control (network coverage, GPS accuracy,
          device battery, terrain and Event staffing). Never rely solely on the Service in an emergency.
        </p>
      </Section>

      <Section n="4" title="Location data & how it is used">
        <p style={p}>
          When you join an Event, the Service collects your device’s geolocation — including in the background while the
          Event is active, if you grant that permission — and shares it with Race Command and assigned Medics. This
          enables responders to find you, to estimate arrival times, and to direct help to the right place. Your live
          position is visible to the Event’s authorised safety personnel for the duration of the Event. You can disable
          location sharing at any time through your device settings, but doing so will limit or prevent the Service’s
          safety features from working.
        </p>
      </Section>

      <Section n="5" title="Incident reports & acceptable use">
        <p style={p}>You agree that you will not:</p>
        <ul style={ul}>
          <li style={li}>submit false, misleading or malicious incident reports, or trigger false alarms;</li>
          <li style={li}>impersonate another participant, Medic or official;</li>
          <li style={li}>upload unlawful, offensive or infringing Content;</li>
          <li style={li}>interfere with, overload, reverse-engineer, or attempt to gain unauthorised access to the Service or its infrastructure;</li>
          <li style={li}>use the Service for any purpose other than your own participation and safety at the Event.</li>
        </ul>
        <p style={p}>
          Submitting a false emergency report may divert responders from a genuine emergency, may be a criminal offence,
          and may result in immediate suspension from the Service and reporting to the Organiser or authorities.
        </p>
      </Section>

      <Section n="6" title="Privacy & data protection">
        <p style={p}>
          We process personal data in accordance with the EU General Data Protection Regulation (GDPR) and applicable
          national law. The categories of data we process include your identity and contact details, bib/registration
          data, geolocation, incident reports, and any medical information you choose to provide (such as allergies,
          conditions and emergency contacts).
        </p>
        <p style={p}>
          <strong>Lawful basis.</strong> Geolocation and incident data are processed to provide the safety service you
          have requested (Art. 6(1)(b)) and, where processing is necessary to respond to a medical emergency, to protect
          your or another person’s vital interests (Art. 6(1)(d)). Health data you provide is special-category data
          processed on the basis of your explicit consent (Art. 9(2)(a)) and/or to protect vital interests where you are
          physically or legally incapable of giving consent (Art. 9(2)(c)).
        </p>
        <p style={p}>
          <strong>Recipients.</strong> Your data is shared only with Race Command, assigned Medics, and the Organiser
          for the purpose of Event safety, and with our hosting and mapping/routing sub-processors strictly as needed to
          run the Service. We do not sell your personal data or use it for advertising.
        </p>
        <p style={p}>
          <strong>Retention.</strong> Live location data is retained only for the duration of the Event and a short
          period thereafter for incident review and safety auditing, after which it is deleted or anonymised. Incident
          records may be retained longer where required to comply with legal obligations or to establish, exercise or
          defend legal claims.
        </p>
        <p style={p}>
          <strong>Your rights.</strong> Subject to applicable law, you have the right to access, rectify, erase,
          restrict or object to the processing of your personal data, the right to data portability, and the right to
          withdraw consent at any time (without affecting processing carried out before withdrawal). You also have the
          right to lodge a complaint with your local data protection authority. To exercise these rights, contact us
          using the details in Section 14.
        </p>
      </Section>

      <Section n="7" title="Third-party services">
        <p style={p}>
          The Service relies on third-party providers for mapping, tiles, geocoding and route calculation, and on mobile
          platform services for location and notifications. Your use of those features may also be subject to the
          relevant third party’s terms. We are not responsible for the availability or accuracy of third-party data.
        </p>
      </Section>

      <Section n="8" title="Intellectual property">
        <p style={p}>
          The Service, including its software, design, trademarks and content (excluding your Content), is owned by us or
          our licensors and is protected by intellectual-property laws. We grant you a limited, personal, non-exclusive,
          non-transferable and revocable licence to use the Service for participating in an Event. You retain ownership
          of your Content but grant us a licence to host, process and transmit it as necessary to operate the Service and
          provide the safety functions described in these Terms.
        </p>
      </Section>

      <Section n="9" title="Disclaimers">
        <p style={p}>
          To the maximum extent permitted by law, the Service is provided “as is” and “as available”, without warranties
          of any kind, whether express or implied, including warranties of merchantability, fitness for a particular
          purpose, accuracy, reliability, uninterrupted availability or non-infringement. We do not warrant that the
          Service will be error-free, secure, or available at all times, or that location, routing or timing information
          will be accurate.
        </p>
      </Section>

      <Section n="10" title="Limitation of liability">
        <p style={p}>
          Nothing in these Terms excludes or limits our liability for death or personal injury caused by our negligence,
          for fraud, or for any other liability that cannot be excluded under applicable law. Subject to that, to the
          maximum extent permitted by law we are not liable for any indirect, incidental, special, consequential or
          punitive damages, or for any loss arising from your reliance on the Service in an emergency, from delayed or
          failed responses, from inaccurate positioning, or from network, device or third-party failures. Where liability
          cannot be wholly excluded, our total aggregate liability arising out of or in connection with the Service is
          limited to the amount (if any) you paid to use it.
        </p>
      </Section>

      <Section n="11" title="Indemnity">
        <p style={p}>
          You agree to indemnify and hold us, the Organiser and Race Command harmless from any claims, losses, liabilities
          and reasonable expenses arising out of your breach of these Terms, your misuse of the Service, or your
          submission of false or unlawful Content.
        </p>
      </Section>

      <Section n="12" title="Suspension & termination">
        <p style={p}>
          We or the Organiser may suspend or terminate your access to the Service at any time, with or without notice, if
          you breach these Terms or if necessary to protect the safety or integrity of the Event. You may stop using the
          Service at any time. Sections that by their nature should survive termination (including those on privacy,
          intellectual property, disclaimers, liability and governing law) will continue to apply.
        </p>
      </Section>

      <Section n="13" title="Changes to these Terms">
        <p style={p}>
          We may update these Terms from time to time. The “Last updated” date above reflects the latest version.
          Material changes will be brought to your attention where practicable. Continued use of the Service after changes
          take effect constitutes acceptance of the revised Terms.
        </p>
      </Section>

      <Section n="14" title="Governing law & contact">
        <p style={p}>
          These Terms are governed by the laws of the jurisdiction in which the Organiser is established, without regard
          to conflict-of-laws rules, and the competent courts of that jurisdiction have exclusive jurisdiction, subject
          to any non-waivable consumer-protection rights you have under your local law. For questions about these Terms,
          to exercise your data-protection rights, or to report a problem, contact the Organiser or Race Command for your
          Event, or reach us through the support channel provided in the app.
        </p>
      </Section>

      <p style={{ ...p, color: "var(--text-muted)", fontSize: 12.5, marginTop: 22 }}>
        By using the Service you acknowledge that you have read and understood these Terms and our Privacy Notice and
        agree to them.
      </p>
    </div>
  );
}

const lead: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 14,
  lineHeight: 1.65,
  margin: "0 0 6px",
};
const p: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 13.5,
  lineHeight: 1.65,
  margin: "0 0 10px",
};
const ul: React.CSSProperties = { margin: "0 0 10px", paddingLeft: 18 };
const li: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 13.5,
  lineHeight: 1.6,
  marginBottom: 4,
};

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 className="archivo" style={{ fontWeight: 800, fontSize: 16, margin: "0 0 8px" }}>
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(245, 158, 11, 0.12)",
        border: "1px solid rgba(245, 158, 11, 0.4)",
        color: "var(--text-primary)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}
