# Radio gateway

An Orange Pi Zero 3 wired to a Hytera X1p, bridging the handset's talkgroup to
an event's team chat in both directions.

Everything for the appliance lives in this folder and is installed on the box on
its own — it is deliberately not part of the monorepo's workspaces, so a box can
be built, bundled and updated without the rest of the platform coming with it.

```
   Hytera X1p ◄──audio──► USB sound card ◄──USB──► Orange Pi Zero 3
                                                        │
                                          venue WiFi ───┤ HTTPS, outbound only
                                                        ▼
                                              events server ──► team chat
                                                        ▲          app, dashboard
                                                        └──────────┘
```

## What it does

**From the radio.** A software squelch watches the channel. When somebody talks,
the transmission is captured (with a pre-roll, so the first syllable survives),
encoded to Ogg Opus, written to the SD card, and uploaded. The server transcribes
it and posts it into the bound event's team chat like any other voice note.

**To the radio.** The box holds a long poll open to the server. When a voice
message is posted in the event's chat it comes back down that poll, is decoded,
and is transmitted: wait for the channel to clear, key up, lead-in, play,
tail, unkey. Text messages are spoken aloud — but only when speech is switched
on for that box, which it is not by default.

**When the link dies.** Recording continues. Transmissions queue on the card and
upload themselves when the server comes back. Nothing is lost because the WiFi
was.

## The two networks

The board's WiFi does one thing at a time, so the box is either serving its own
setup network or on the venue's:

```
  power on ──► EM-Radio-XXXX (setup) ──[you pick a WiFi]──► venue network
                    ▲                                            │
                    └──── "Bring back the setup WiFi" ───────────┘
                          from the dashboard, or automatically
                          after 10 minutes with no server
```

The setup network's password is in `config.json` (`ap.password`). Joining it
opens the console by itself — the box answers every captive-portal probe a phone
makes.

## The console

Served by the box on port 80, at `http://10.42.0.1` in setup mode or at its
address on the venue network.

- **Live** — what the channel is doing, right now: a scrolling scope of the last
  30 seconds with the squelch thresholds drawn on it, level meters, hold-to-talk
  from the phone's microphone, a live listen, and the two wiring tests.
- **Traffic** — every transmission in and out, playable, with whether it reached
  the server.
- **Logs** — the live log, filtered by subsystem.
- **Setup** — server and key, event, WiFi, sound card, squelch, keying, the
  access point, storage, and maintenance.

## Getting a box running

1. Flash Armbian for the Orange Pi Zero 3 and boot it with a network cable or a
   keyboard, long enough to get a shell.
2. Copy this folder to the box (or a release bundle — see `delivery.md`).
3. `sudo ./scripts/install.sh`
4. Join `EM-Radio-XXXX` from a phone. The console opens.
5. Paste the gateway key from **Settings → Digital radio** in the dashboard,
   pick the venue WiFi, pick the event.
6. Wire the radio per `WIRING.md` and set the levels with the meters running.

## Development

The daemon runs on a laptop with the hardware faked out:

```bash
npm install && npm run build
GATEWAY_STATE_DIR=./.dev-state GATEWAY_FAKE_HARDWARE=1 GATEWAY_HTTP_PORT=8099 node dist/index.js
```

`GATEWAY_FAKE_HARDWARE=1` replaces `arecord` with silence, `aplay` with
`/dev/null`, `nmcli` with a fixed answer, and GPIO with a no-op. The console,
the HTTP API, the squelch, the codecs and the store are all real.

The console has its own dev server with hot reload:

```bash
GATEWAY_DEV_TARGET=http://localhost:8099 npm run dev:ui
```

## Layout

```
src/
  index.ts          entry point; port 80 with a fallback
  daemon.ts         owns every component and the wiring between them
  config.ts         the one JSON file the box remembers
  logger.ts         ring buffer + SSE + rotated file
  updater.ts        self-update: download, verify, swap a symlink
  audio/            ALSA capture and playback, squelch, ffmpeg, formats
  radio/            PTT backends and the half-duplex transceiver
  net/              NetworkManager: access point and client
  server/           the outbound-only link to the events server
  store/            recordings on the SD card, disk-capped
  http/             the console's API and static hosting
ui/                 the console (React + Vite), built into public/
scripts/            install, release bundle, dev deploy
provisioning/       captive portal, udev rules
systemd/            the service unit
```

## The server side

Lives in the main repo, not here:

- `apps/backend/src/modules/ptt/providers/radio/` — the fleet registry, the
  device API the boxes call, and the firmware bundle service.
- `apps/web/src/components/ptt/GatewayFleet.tsx` — the dashboard panel.
- `packages/contracts/src/index.ts` — the shared types. `src/types.ts` here is a
  hand-kept copy of the relevant slice; keep the two in step.
