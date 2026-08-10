# Feature graphic — generation brief

Google Play requires a **feature graphic: 1024 × 500 px, PNG or JPEG, no
transparency**. It sits at the top of the store listing and is the first thing
anyone sees.

## Hard constraints (these are Play rules, not taste)

- Exactly 1024 × 500 px, no alpha channel.
- Keep every important element inside the **centre ~924 × 400 px** — Play crops
  the edges on some surfaces, and a play button is overlaid dead-centre if a
  promo video is ever added.
- No fake UI: no invented buttons, no "Install", no star ratings, no Google Play
  badges. Play rejects these.
- No device frames or phone mockups.
- Minimal text. A wordmark plus a short tagline is the maximum that stays
  legible when the banner is scaled down on a phone.
- Nothing that implies the app dispatches real emergency services to the public.

## The prompt

Paste this into the image model:

> A 1024×500 horizontal banner graphic for a professional mobile app called
> **Extreme Medics**, used by paramedics and doctors covering mountain races and
> outdoor endurance events.
>
> Composition, left to right: the left 40% is a deep near-black navy panel
> (#0B1220) carrying the app name "EXTREME MEDICS" in a bold, condensed,
> uppercase geometric sans-serif in white, with a single short tagline beneath
> it in mint green (#22C55E): "Coordination for race medical teams". Beneath the
> text, a small emblem: a white six-point Star of Life with a rod of Asclepius,
> flat and clean, no bevel or gloss.
>
> The right 60% is a stylised topographic map rendered in the same dark theme —
> dark slate terrain with thin mint contour lines, a river in muted blue, and a
> single bright winding race track drawn as a glowing gradient line running from
> mint green into electric blue, with a soft outer glow. Sitting on that track
> are a few flat circular map pins: two red pins with a small white ambulance
> glyph, one red pin with a white exclamation mark surrounded by a faint
> concentric pulse ring, and two blue pins with a white water-drop glyph. Behind
> the map, low silhouetted mountain ridges in dark grey-green fade into the
> background with pine trees along the ridgeline.
>
> Style: modern, technical, calm and operational — closer to a professional
> dispatch console than to a consumer fitness app. Flat vector illustration with
> subtle depth, crisp edges, high contrast against the dark background, generous
> negative space. Cinematic but restrained lighting, a faint mint glow radiating
> from the track. No people, no faces, no device mockups, no user interface
> panels, no buttons, no logos other than the described emblem.
>
> Colour palette: background #0B1220, mint green #22C55E, electric blue #3B82F6,
> alert red #EF4444, white #FFFFFF, muted slate #64748B.

### Negative prompt

> photorealistic photo, real people, faces, hands, blood, injuries, gore,
> hospital interior, phone mockup, device frame, app screenshot, UI panels,
> buttons, star ratings, Google Play badge, watermark, signature, stock photo
> look, cluttered composition, tiny illegible text, lens flare, 3D render,
> glossy plastic, drop shadows on text, misspelled text

### If the model garbles the text

Most image models still misspell. Safest path: generate the graphic **without
any text** — ask for the map/mountain composition with an empty dark panel on
the left — then add "EXTREME MEDICS" and the tagline yourself in Figma, Canva or
Keynote. Text rendered as real type is sharper anyway at this size.

### Aspect ratio workaround

1024 × 500 is roughly 2.05:1, which few models offer directly. Generate at
**2048 × 1000** if the model supports custom sizes; otherwise generate 16:9
(e.g. 1920 × 1080) with the composition centred, then crop to 2048 × 1000 and
downscale to 1024 × 500.

## Reference images to attach

Attach these with the prompt — most models take image references, and they pin
down the brand far better than words:

| Attach | Path | Why |
|--------|------|-----|
| App icon | `apps/mobile/assets/icon-android.png` | The Star of Life emblem, the mountain-and-trail motif, and the green→blue trail gradient all come from here. Tell the model: "match this emblem and colour language". |
| Live map screenshot | `apps/mobile/store/play/screenshots-phone/01-live-map.jpg` | Gives the real map-pin vocabulary — red ambulance pins, blue water-drop pins, the purple/blue track line. |
| Closest-medic screenshot | `apps/mobile/store/play/screenshots-phone/02-closest-medic.jpg` | Establishes the dark UI, the mint accent, and the incident pulse ring. |

Do **not** attach a real photo of a race or a medical team unless you own the
rights to it — Play will pull the listing over an image you can't license, and a
real patient in frame is a separate problem entirely.

## Checking the result before upload

- Open it at 25% zoom — if the tagline is unreadable, the text is too small.
- Confirm the file is exactly 1024 × 500 and has no alpha:
  `sips -g pixelWidth -g pixelHeight -g hasAlpha feature-graphic.png`
- Save the final file next to this one as `feature-graphic.png`.
