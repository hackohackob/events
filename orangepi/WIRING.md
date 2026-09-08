# Wiring an Orange Pi Zero 3 to a Hytera X1p

Three connections: audio out of the radio, audio into the radio, and — unless
you are using VOX — a line that keys the transmitter.

```
   Hytera X1p                USB sound card              Orange Pi Zero 3
  ┌───────────┐             ┌──────────────┐            ┌───────────────┐
  │  speaker  ├────────────►│ MIC IN       │            │               │
  │           │             │              ├───USB─────►│  USB host     │
  │  mic in   │◄────────────┤ HEADPHONE OUT│            │               │
  │           │             └──────────────┘            │               │
  │  PTT      │◄──────────────── opto-isolator ◄────────┤  GPIO pin     │
  │  ground   │◄─────────────────────────────────────── ┤  GND (pin 6)  │
  └───────────┘                                         └───────────────┘
```

## Audio

The X1p's accessory connector is proprietary; you need a Hytera audio cable
(the PC/ACC series) broken out to two 3.5 mm plugs, or a headset cable cut and
re-terminated. Whichever you use:

- **Radio speaker → sound card MIC IN.** Line level out of a radio is much
  hotter than a microphone expects. If the IN meter in the console pins red at
  the lowest input gain, put a resistor divider in this line (10 kΩ in series,
  2.2 kΩ to ground is a reasonable starting point) or use the sound card's
  line-in if it has one.
- **Sound card HEADPHONE OUT → radio mic in.** The opposite problem: a radio's
  microphone input wants a few millivolts and a headphone output delivers
  volts. Start with the output gain low, and add a divider if everything you
  transmit sounds distorted however low you set it.

Set the levels from the console's **Live** tab with the meters running. Speech
should reach roughly two thirds of the bar. Red means clipping, and clipping
over a narrowband radio is the difference between hearing words and hearing
mush.

## Keying

Pick one in **Setup → Keying the radio**.

### VOX (no extra wiring)

Turn VOX on in the radio's own menu. The box prepends a short low tone to every
transmission specifically to open the VOX gate before the first word, which
removes most — not all — of VOX's usual clipping. Nothing to wire, nothing to
verify. Start here.

### GPIO pin (recommended once it is working)

The radio's PTT is keyed by pulling it to ground. Do **not** connect a GPIO pin
directly: the radio's PTT line may sit above 3.3 V and the SoC will not survive
it. Use an opto-isolator or a small-signal transistor:

```
  GPIO ──[1 kΩ]──► opto LED anode
                   opto LED cathode ──► Pi GND

  opto collector ──► radio PTT
  opto emitter   ──► radio GND
```

A PC817 and a 1 kΩ resistor are enough. With `Pulling the pin low keys the
radio` **on** (the default), the console drives the pin low to key — which is
what the wiring above expects when the opto is driven from 3.3 V through the
resistor to the pin.

**Finding the GPIO number.** The console wants the kernel's number, not the
header position. On the Zero 3:

```bash
# List the header pins and their kernel numbers
gpio readall 2>/dev/null || cat /sys/kernel/debug/gpio

# Or, with libgpiod:
gpioinfo gpiochip0 | head -40
```

Physical pin 7 on the 26-pin header is a common choice. Whatever you pick, put
its **kernel number** in the console.

**Verifying it.** This is the part you cannot check by looking at the radio, so
the box checks it for you: **Setup → Check the keying line** pulses the pin,
reads it back through sysfs, and reports whether it actually moved.

- *"Pin 76 went to 0 when keyed and back to 1"* — the line is moving. If the
  radio still does not transmit, the fault is in the cable or the opto, not the
  software.
- *"Could not read the pin back"* / *"GPIO is not accessible"* — the kernel has
  no sysfs GPIO, or the number is wrong. The box falls back to `libgpiod`, which
  works but cannot read back; you will have to confirm on the radio itself.

Then use **Test transmit** and listen for the chirp on a second handset.

### Sound card GPIO (CM108/CM119)

If your USB dongle uses a C-Media chip, GPIO3 on it is the standard ham-radio
PTT pin, driven over HID by the box. Still needs the opto-isolator between the
dongle and the radio. Check the chip first:

```bash
lsusb | grep -i c-media   # 0d8c:... is C-Media
```

## Power

The Zero 3 wants a solid 5 V/2 A supply. A USB sound card, WiFi transmitting,
and an SD card write happening together is exactly the load that makes an
underpowered board brown out — which looks, from the dashboard, like a box that
keeps going offline for no reason. If a box drops repeatedly and the logs stop
mid-line rather than reporting an error, suspect the supply before the software.
