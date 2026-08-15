# iOS deploy checklist — Extreme Medics

Tracking the fixes for App Review submission `245a6197-47e4-4390-9ddd-9bd1d860fdb0`
(rejected 2026-07-23, version 1.0 build 1, reviewed on iPad Air 11" M3).

Bundle ID: `com.academyfirstaid.extrememedics` · EAS project `ffe5d9fa-a192-4b34-be11-5a43598959c3`

**Target distribution: Unlisted App Distribution — DECIDED.** The app stays on the App Store
infrastructure (so installs, updates and OTA all work normally) but it does not
appear in search, charts, or category browsing. It is reachable *only* via a direct
link, which is exactly the "share it with links to our people" requirement. See §3.

---

## ✉️ Reply to send in App Store Connect

**Send this only once the new build is uploaded** — points 1 and 2 below claim changes
that only exist in a new binary. Replace `<VIDEO LINK>`, `<DEMO USER>` and `<DEMO PASSWORD>`
before sending. Paste the same demo credentials and video link into
*App Review Information → Notes*.

---

Hello,

Thank you for the detailed review. We have addressed all four issues. Below is our
response to each one, in order.

**Guideline 5.1.2(i) — Data Use and Sharing**

The app does not track users, on this platform or on any other platform. It contains no
advertising SDKs, no analytics SDKs, and no third-party attribution or measurement SDKs,
and it does not share any collected data with data brokers. No data collected by the app
is ever linked with third-party data for advertising purposes.

The rejection was caused by an error in our App Privacy questionnaire: the "Name" data
type had been incorrectly marked as used for tracking purposes. That was a mistake on our
part — names are collected solely to identify a medic to their own dispatcher within an
event. We have corrected the App Privacy information in App Store Connect, and the
"Data Used to Track You" section no longer appears on our product page. All declared data
types are now marked as used for App Functionality only.

Because the app does not track, it does not present an App Tracking Transparency prompt.

**Guideline 5.1.1(ii) — purpose strings**

We have rewritten the camera, microphone and photo library purpose strings so that each
one states what the data is used for and gives a concrete example. The new strings in this
build are:

- *Camera (NSCameraUsageDescription):* "Extreme Medics uses the camera so you can photograph
  an incident scene — for example, a picture of an injured runner's position that event
  command and the receiving hospital can see before the ambulance arrives."
- *Photo library (NSPhotoLibraryUsageDescription):* "Extreme Medics needs your photo library
  so you can attach an existing photo to an incident report or a team chat message — for
  example, a picture of a hazard on the track you took earlier."
- *Microphone (NSMicrophoneUsageDescription):* "Extreme Medics uses the microphone for
  push-to-talk radio and voice notes — for example, dictating a casualty's condition to
  event command while your hands are busy treating them."

We have also made the location purpose strings more specific about the background use.
The prompts appear in the app as follows: the camera and photo library prompts on the
"Report Incident" screen and in the event chat when attaching an image; the microphone
prompt when starting a voice note or push-to-talk transmission; the location prompts on
first launch and when a medic goes on duty for an event.

**Guideline 3.2 — Business**

Your assessment is correct: this app is intended for a specific group of organisations,
not for the general public. We are therefore requesting Unlisted App Distribution and have
submitted the request form. Answers to your questions:

1. *Is the app restricted to users who are part of a single company or organisation?*
   Yes. It is used by Extreme Medics staff and by the medical crews, contractors and
   volunteers working the events we are contracted to cover.
2. *Is the app designed for use by a limited or specific group of companies or
   organisations?* Yes — event medical providers and the race organisers we work with.
   Another organisation can become a client, but only through a commercial agreement with
   us; there is no way for an organisation to sign itself up from within the app.
3. *What features are intended for use by the general public?* None. Every screen requires
   an account that a coordinator has created and assigned to a specific event. A member of
   the public who installed the app would have nothing to use.
4. *How do users obtain an account?* A coordinator at Extreme Medics creates the account
   and assigns the user to an event. There is no self sign-up, no public registration and
   no invitation flow open to the public.
5. *Is there any paid content in the app?* No. There are no in-app purchases and no
   subscriptions, and users never pay anything. The event organiser pays Extreme Medics for
   the medical service under a separate commercial contract, entirely outside the app.

**Guideline 2.1 — demo video**

A demo video recorded on a physical iPhone is available here: `<VIDEO LINK>`

The video shows the app in use on a real device and documents, in order: first launch and
sign-in, each permission request with its purpose string, a medic going on duty for an
event, the app being backgrounded and the device locked, continuous location updates being
delivered while the app is in the background, and the resulting track visible to the
dispatcher afterwards. It also shows an incident being reported with a photo and a voice
note.

Background location is core to the app's purpose: a medic must remain visible to the
dispatcher while their phone is locked in a pocket during an event, otherwise the
dispatcher cannot send the nearest medic to a casualty.

Demo account: `<DEMO USER>` / `<DEMO PASSWORD>` — it is permanently assigned to a demo event
that is always active, so the reviewer can reach every feature at any time.

The app behaves identically in all countries and regions, and the video remains valid for
all storefronts.

Please let us know if anything further is needed.

Best regards,
Atanas Atanasov
Extreme Medics

---



## 0. Decide the distribution model (do this first — it changes everything else)


| Option                              | Fits?         | Notes                                                                                                                                          |
| ----------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unlisted on the App Store**       | ✅ recommended | Link-only, anyone with the link installs it, no MDM, no per-user invites, unlimited installs, normal review. Requires a request form to Apple. |
| Custom App (Apple Business Manager) | ⚠️ heavy      | Needs each client org to have an ABM account and to redeem the app; good for enterprise clients, painful for volunteer medics.                 |
| TestFlight only                     | ⚠️ temporary  | 90-day build expiry, 10 000 external testers, tester must install TestFlight. Fine as a stopgap while unlisted is approved.                    |
| Apple Developer Enterprise Program  | ❌             | Only for employees of your own company, $299/yr, hard to qualify for.                                                                          |


- [x] Confirm we go **Unlisted**
- [ ] Keep TestFlight running in parallel as the interim channel for the team

---



## 1. Guideline 5.1.2(i) — App Tracking Transparency

**Verdict: the app does not track.** There is no ad SDK, no analytics SDK, no data
broker, and no third-party data linking anywhere in `apps/mobile` (deps are Expo,
MapLibre, notifee, socket.io — none of them advertising). The rejection is caused by
a wrong answer in the App Store Connect privacy questionnaire, not by the code.

So: **fix the label, do not add ATT.** Adding an ATT prompt you don't need is its own
rejection risk ("permission request that serves no purpose").

- [x] **Name → "Used for tracking purposes" = No.** This single flag was the whole
  ```
  rejection: the label declared Name as tracking data. Published 2026-08-10.
  The "Data Used to Track You" card is now gone from the product page preview.
  ```
- [x] Name / Email Address / Phone Number / Precise Location → marked **Linked to the
  ```
  user's identity** (they were declared "not linked", which was false — coordinators
  create named accounts). All still App Functionality only, no tracking.
  ```
- [ ] Remaining linkage corrections — **App Store Connect's UI crashes on these**
  ```
  (blank page, `removeChild` TypeError + HTTP 409 in the console; Apple-side bug,
  not our data). Retry later or in Safari:
  ```
  - Sensitive Info → should be **Linked to the user's identity** (incident notes are tied to a patient record)
  - Photos or Videos → **Linked** (attached to an incident by a named medic)
  - Audio Data → **Linked** (voice notes attached to an incident)
  - Crash Data → leave **Not Linked** (correct as-is)
- [x] Verify the Privacy Policy URL: the page currently shows
  ```
  `https://events.academyfirstaid.com/privacy` and User Privacy Choices
  `https://events.academyfirstaid.com/terms` — confirm both actually resolve
  ```
- [x] Confirm no third-party SDK is doing tracking on our behalf — deps audited 2026-08-10:
  ```
  Expo, MapLibre, notifee, socket.io, zustand. No ad SDK, no analytics SDK, no data broker.
  Re-check before each submission if deps changed.
  ```
- [ ] Reply in App Store Connect — use the 5.1.2(i) section of the full reply at the top of this file

> Requires Account Holder or Admin role to edit the privacy label. If the fields are
> locked, reply to the rejection and say so — Apple will unlock or advise.

---



## 2. Guideline 5.1.1(ii) — purpose strings

The current camera / microphone / photo-library strings are Expo's **defaults**
("Allow Extreme Medics to access your camera") — generic, no example of use. That is
precisely what Apple flagged. The location strings in `apps/mobile/app.config.ts` are
already specific and can stay (tighten the Always string anyway, see below).

Where each permission is actually used:


| Permission                      | Used in                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera                          | `src/incidents/ReportIncidentSheet.tsx:256`, `src/incidents/IncidentSheet.tsx:548`, `src/chat/EventChatScreen.tsx:726` — photograph an incident scene / casualty |
| Photo library                   | same screens, `launchImageLibraryAsync` — attach an existing photo to an incident or chat                                                                        |
| Microphone                      | `expo-audio` in `src/incidents/IncidentSheet.tsx`, `src/chat/EventChatScreen.tsx` — voice notes and push-to-talk radio                                           |
| Location (When In Use / Always) | live position on the event map + background tracking while on duty                                                                                               |


- [x] Add explicit camera / photos / microphone strings — set as **props on the
  ```
  `expo-image-picker` and `expo-audio` config plugins** in `apps/mobile/app.config.ts`,
  not just in `ios.infoPlist`. Those plugins are auto-applied and would otherwise
  overwrite `infoPlist` with Expo's generic defaults. `NSPhotoLibraryAddUsageDescription`
  has no plugin prop, so it lives in `ios.infoPlist`.
  ```
- [x] Tighten the three `expo-location` strings so each names the background use and gives an example
- [x] Drop the unused `expo-camera` dependency (no `CameraView` / `useCameraPermissions` anywhere —
  ```
  `expo-image-picker` handles capture). One less permission SDK for review to question.
  ```
- [x] Verify the resolved plist: `npx expo config --type introspect` — all seven
  ```
  `NS*UsageDescription` keys carry the new text
  ```
- [ ] `npx expo prebuild -p ios --clean` and confirm the strings landed in `ios/*/Info.plist`
- [ ] Verify on device that each prompt shows the new text

---



## 3. Guideline 3.2 — business / distribution

The app *is* organisation-scoped (Extreme Medics staff and event partners), so arguing
"general public" would be dishonest and would fail again. Take the unlisted route.

- [ ] Request unlisted distribution: [https://developer.apple.com/contact/request/unlisted-app](https://developer.apple.com/contact/request/unlisted-app)
  - App name, Apple ID (numeric app ID from ASC), bundle ID
  - Describe the audience: event medical teams, race organisers and their crews
  - Explain why it is not public: accounts are created by a coordinator, the app is
  useless without being assigned to a live event
- [ ] While waiting, reply to the 3.2 rejection — the answers are in the full reply at the top of this file (the draft below is the same text)
- [ ] Once approved, in ASC set **Pricing and Availability → Distribution → Unlisted**
- [ ] Grab the direct App Store link and put it behind our own short link / QR for the crews



### Answers to Apple's five questions (draft — edit to match reality before sending)

1. **Restricted to a single company/organisation?** Yes in practice — the app is used
  by Extreme Medics and by the medical crews of the events we cover. Users must be
   invited by a coordinator.
2. **Designed for a limited or specific group?** Yes — event medical providers and
  race organisers we contract with. New organisations can become clients, but only
   after a contract; they cannot self-register in the app.
3. **Features for the general public?** None. Every screen requires an account tied to
  an event. (Public race-tracking pages exist, but on the web, not in this app.)
4. **How do users obtain an account?** A coordinator creates the account and assigns
  the medic to an event. There is no self sign-up.
5. **Paid content?** No in-app purchases and no fee to users. The event organiser pays
  Extreme Medics for the service under a separate commercial contract.

---



## 4. Guideline 2.1 — demo video for background location

Apple wants to see background location working on a **physical device**.

- [ ] Record on a real iPhone (iOS screen recording), one continuous take, ~2–4 min, no cuts
- [ ] Script:
  1. Fresh install / first launch — show the **login** with the demo account
  2. Show the **location permission prompt** and the purpose string, tap *Allow While Using*
  3. Join / go on duty for a demo event
  4. Show the prompt to upgrade to **Always** (background) and the purpose string
  5. Lock the phone or switch to another app — show the blue status bar / location indicator
  6. **Walk or drive** while the app is backgrounded for 30–60 s
  7. Return to the app (or show the web dashboard on a second screen) and show the
    **track that was recorded while backgrounded** — this is the proof Apple asked for
  8. Show the microphone prompt (voice note / PTT) and the camera prompt (incident photo)
    with their new purpose strings
  9. Show an incident being reported and received
- [ ] Narrate or caption each step in English
- [ ] Upload unlisted to YouTube / Vimeo, no login required to view, link never expires
- [ ] Paste the link in **App Review Information → Notes**, plus the note that the video
  ```
  remains valid for all storefronts if unchanged
  ```
- [ ] Verify the link opens in a private browser window

---



## 5. App Review Information (Notes field) — final text

- [ ] Demo account: username + password of a real, permanently-active demo user assigned
  ```
  to a permanently-running demo event (App Review must not hit "no active event")
  ```
- [ ] Create/verify that demo event exists in production and never ends
- [ ] Notes should state:
  - Where each permission prompt appears (screen names)
  - That the app does not track and contains no ad/analytics SDKs
  - Demo video link
  - That background location is core functionality: a medic's position must reach the
  dispatcher while the phone is pocketed or locked during an event

---



## 6. Build & submission mechanics

- [ ] Bump `apps/mobile/package.json` version (`npm run release:mobile patch`) — it drives `app.config.ts`
- [ ] Bump iOS build number (EAS `autoIncrement`)
- [ ] `eas build -p ios --profile production`
- [ ] Check `ITSAppUsesNonExemptEncryption: false` is still in the built Info.plist (skips export compliance)
- [ ] `eas submit -p ios`
- [ ] Sanity-check that the production build points at the **production API**, not the local
  ```
  `.env` URL — OTA/`eas update` inlines `apps/mobile/.env`
  ```
- [ ] Screenshots: 6.9" iPhone required. `supportsTablet: false`, so no iPad set needed —
  ```
  but review will still run it on an iPad in compatibility mode, so smoke-test that
  ```
- [ ] Support URL reachable on `academyfirstaid.com` (Privacy Policy URL already verified, see §1)
- [ ] Age rating questionnaire completed (medical/incident content)

---



## 7. Resubmit

- [ ] All boxes above ticked
- [ ] Reply to each of the four rejection points in the App Store Connect message thread,
  ```
  referencing what changed
  ```
- [ ] Submit for review
- [ ] After approval: switch to Unlisted, distribute the link internally