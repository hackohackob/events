# Delivery notes

Everything about getting software onto a gateway box and keeping track of what
is on which one. Append to the log at the bottom every time a box is built,
updated or handed over.

---

## How updates reach a box

Boxes update themselves from the events server. Nobody SSHes into a deployed
gateway.

```
  laptop                        VPS                          box in the field
  ──────                        ───                          ────────────────
  build-bundle.sh
     │  em-gateway-1.2.0.tar.gz
     └──────── scp ───────────► /opt/events/gateway/
                                     │
                                     │  API serves the newest bundle
                                     │  + its sha256
                                     │
                                     └──── heartbeat says "1.2.0 available" ──►
                                                                            │
                                     ◄──── download, verify, unpack ────────┘
                                                                    swap symlink
                                                                    restart
```

Releases are unpacked side by side and a symlink is moved, so the previous one
is still on the card:

```
/opt/em-gateway/releases/1.1.0/
/opt/em-gateway/releases/1.2.0/
/opt/em-gateway/current -> releases/1.2.0
```

Settings live in `/var/lib/em-gateway/`, never inside a release, so an update
never touches a box's configuration or its recordings.

### Publishing a release

```bash
# 1. Bump the version
cd orangepi && npm version patch --no-git-tag-version

# 2. Build the bundle (daemon + console + production dependencies)
./scripts/build-bundle.sh

# 3. Publish it
scp dist-bundle/em-gateway-<version>.tar.gz root@<vps>:/opt/events/gateway/

# 4. Optionally, notes shown alongside it
scp notes.txt root@<vps>:/opt/events/gateway/em-gateway-<version>.notes.txt
```

That is the whole deploy. The server hashes the file itself and advertises the
newest version it finds; nothing needs restarting.

### Rolling it out

- **One box:** dashboard → Settings → Gateway boxes → the box → **Update**. It
  is queued and picked up within a minute.
- **From the box itself:** its console → Setup → Maintenance → **Install the
  update**.
- **Rolling back:** delete the bad tarball from `/opt/events/gateway/` and put
  the previous one back, then update each box again. The box's previous release
  is still in `/opt/em-gateway/releases/` if a card has to be fixed by hand.

### If an update fails

The box refuses a bundle whose checksum does not match and one missing
`dist/index.js`, and says so in its log. It stays on the running release either
way, so a bad publish costs nothing but a retry.

---

## Building a new box from scratch

**Hardware**

| Part | Notes |
| --- | --- |
| Orange Pi Zero 3 | 1 GB is enough. 2 GB is fine. |
| Power supply | 5 V, 2 A, and a good cable. Under-powering causes mystery reboots. |
| microSD | 16 GB+, A1-rated. Recordings are capped at 2 GB by default. |
| USB sound card | A C-Media (0d8c) one if you want sound-card PTT. |
| Hytera audio cable | PC/ACC series, broken out to two 3.5 mm plugs. |
| Opto-isolator | PC817 + 1 kΩ, if keying over GPIO. See `WIRING.md`. |

**Software**

1. Flash Armbian (Bookworm, minimal) for the Orange Pi Zero 3.
2. First boot: set a root password, skip the desktop user if offered.
3. Get this folder onto the box — a USB stick, `scp` over a cable, or:
   ```bash
   scp -r orangepi root@<box>:/tmp/em-gateway-src
   ```
   A release bundle works too; unpack it and run the installer from inside.
4. `sudo ./scripts/install.sh`
5. Join `EM-Radio-XXXX` (password `12345687`) from a phone.
6. In the console: gateway key → venue WiFi → event.
7. Wire the radio (`WIRING.md`), set the levels, run **Check keying** and
   **Test transmit**.
8. Write the box's name and ID on a label and add a row to the log below.

**Time:** about 25 minutes, most of it `apt-get`.

---

## Setting the audio levels

Do this once per box, with the radio and cabling it will actually be used with.
It takes five minutes and it is the difference between a log full of speech and
a log full of mush.

**Set the radio's volume knob low — around a quarter of its range — and leave
it there.** This is counter-intuitive and it is the single most important
setting. A handset's speaker output is volts; a sound card's microphone input
expects millivolts. Turned up, the input is overloaded hundreds of times over,
which does not sound like distortion so much as *boominess*: overload produces
intermodulation and emphasises the low end. The giveaway is that a second
handset listening to the same transmission sounds fine — proof the problem is
in the cable into the box, not on the air.

Turning the radio up does not give the box more signal. It gives it more
distortion, and distortion cannot be undone anywhere downstream.

**Then make up the level in the capture gain**, not on the radio:

```bash
amixer -c 1 sset 'Mic' 9 cap    # +13 dB on a PCM2902; 0-16 scale
amixer -c 1 sset 'Auto Gain Control' off
alsactl store                    # survives a reboot
```

AGC must be off. It continuously rides the level, which makes a fixed squelch
threshold meaningless.

**Check it with the console's meters** while somebody talks. Aim for peaks
around **0.35–0.55**. A worked example from the first box, radio at 4–5 of 16,
capture gain 9: live peak 0.363, and across 13 recordings zero clipped. Peaks
of 1.0 mean the converter clipped and that audio is already lost — headroom
matters far more than loudness, because the encoder evens the level out anyway.

**If it is still too quiet with the gain near maximum**, the fix is a resistor
divider in the cable rather than more gain: 10 kΩ in series with 2.2 kΩ to
ground lets the radio run at a comfortable setting without overloading the
input. `WIRING.md` has the detail.

---

## Handing a box to somebody

What the person receiving it needs to know, and nothing more:

- The box's WiFi name and password, for when they need the console.
- That the console is at `http://10.42.0.1` and usually opens by itself.
- That **Live → Test transmit** is how they check the radio link, and
  **Traffic** is how they hear what was said.
- That if it stops working: power-cycle it, wait two minutes, and if it still
  will not join the venue WiFi it puts its own network back up by itself.
- That they should not need to change anything in **Setup**.

---

## Troubleshooting a deployed box

| Symptom | First thing to check |
| --- | --- |
| Not in the dashboard at all | Wrong gateway key, or the radio bridge is switched off in Settings. The box's console says which. |
| Online, but nothing reaches the chat | The event's `Radio → app` switch, in the dashboard's routing section. |
| Nothing goes out on the air | The `App → radio` switch; and whether keying is set to "Receive only". |
| Text is not spoken | Speech is off by default. Turn it on per box in the dashboard. |
| Records constant noise | Squelch opens too low. Raise "Opens at" while watching the scope. |
| Cuts people off mid-sentence | Raise "Hangs on for", and lower "Closes below". |
| Transmits but nobody hears it | Keying. Run **Check keying**; if the line moves, the fault is the cable. |
| Everything sounds distorted | Output gain too high, or no divider between the sound card and the radio's mic input. |
| Drops offline repeatedly | Power supply, before anything else. |
| Cannot reach it at all | Dashboard → the box → **Bring back the setup WiFi**, then walk up to it with a phone. |

Logs, if somebody does have a shell:

```bash
journalctl -u em-gateway -f          # live
tail -200 /var/lib/em-gateway/gateway.log
cat /var/lib/em-gateway/config.json
```

---

## Fleet log

One row per box, updated whenever something changes on it.

| Box name | ID (first 8) | Serial / label | Radio | Keying | Built | Version | Where it is | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _example_ | `a1b2c3d4` | EM-GW-01 | Hytera X1p | GPIO 76 | 2026-09-08 | 1.0.0 | store | first build |

---

## Release log

| Version | Date | What changed | Rolled out to |
| --- | --- | --- | --- |
| 1.0.0 | 2026-09-08 | First release: squelch and recording, two-way bridging, console with live scope and push-to-talk, WiFi setup, self-update. | — |

---

## Server-side checklist

Things that have to be true on the VPS for any of this to work.

- [ ] `/opt/events/gateway/` exists and is mounted into the API container
      (already in `docker-compose.prod.yml` as `RADIO_GATEWAY_BUNDLE_DIR`).
- [ ] A gateway key is set in the dashboard: **Settings → Digital radio**, and
      the provider's master switch is on. Boxes cannot authenticate otherwise.
- [ ] `OPENAI_API_KEY` is in `/opt/events/.env` if text should be spoken over
      the air. Without it, speech is silently unavailable.
- [ ] ffmpeg with libopus in the API image — already required by the Zello
      bridge, so this is normally already true.
- [ ] The API's read timeout is at least 30 s: the boxes hold a 25-second long
      poll open, and a proxy that cuts it shorter turns every poll into an
      error in the box's log. nginx: `proxy_read_timeout 60s;`

---

## Things that will bite

Written down because each of these cost real time once.

- **The setup access point and the venue WiFi cannot both be up.** The Zero 3's
  AIC8800 will not do it reliably. Everything in the design follows from this:
  the AP is on a timer, the dashboard can call it back, and the box puts it back
  by itself after ten minutes with no server.
- **A box in AP mode is not bridging anything.** It is off the venue network by
  definition. Do not leave one in setup mode during an event.
- **`config.json` is not in the bundle.** Copying a whole `/opt/em-gateway` tree
  from one box to another does *not* clone its settings, and cloning an SD card
  does not clone its identity either — the box ID is derived from the machine-id,
  so a cloned card comes up as a new box in the dashboard. That is deliberate:
  two boxes claiming one row would be worse.
- **`src/types.ts` is a hand-kept copy** of the radio-gateway slice of
  `packages/contracts`. Change one, change the other, or a box will quietly
  misread a heartbeat response.
- **ffmpeg's native Opus decoder is broken** for handset audio — the box forces
  `-c:a libopus`, same as the server. An ffmpeg built without libopus will
  produce audible garbage rather than an error.
