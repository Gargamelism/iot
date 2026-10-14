# Solar Catrina dancer: she dances and plays a mariachi tune when you tap her

## Context

The figure is an off-the-shelf solar "dancing" dashboard toy: a Catrina (Day of the Dead
skeleton lady with a fan) on a purple base. AliExpress item 1005009364052577, ~₪6. Inside the
base, a tiny solar cell (~3×1 cm) powers a small driver circuit and coil. It rocks the upper
body back and forth whenever there's light. There is no spring head.

It lives on a **car dashboard in Israel**. In summer the dashboard surface reaches 70–90 °C,
and that shapes the power design (see "Why supercapacitors").

That changes the original "head moves → play" idea in three ways:

1. **She moves by herself all day in light**, so motion can't be the trigger. Instead **the
   ESP32 powers her driver circuit**, so she stays still until triggered. A tap on her or the box
   closes an SW-18010P vibration switch, which wakes the board. It then plays the tune and
   powers her driver, so she dances only while the music plays.
2. **Her base is far too small** for the board, energy storage, speaker and a usable panel. Her
   milliwatt solar cell can't power any of it. The doll, still in her own purple base, is
   glued onto a **larger enclosure** with a real panel on its lid.
3. **The car vibrates while driving**, which would close the vibration switch on every bump.
   Firmware tells a tap from road vibration and stays silent while driving.

Reused from this repo:

- **Board**: the ABRobot ESP32-C3 0.42" OLED board. The OLED is never initialized and stays dark.
- **Audio**: the MAX98357A I2S amp on the existing `PIN_I2S_*` pins (GPIO4/7/10), driven the
  way `player/player.ino` does it: an embedded 16-bit PCM clip over I2S.
- **Clip conversion**: `player/wav_to_header.py` turns a WAV into `clip.h` with no changes.

## Why supercapacitors, not a battery

A Li-ion or LiPo cell should be stored below ~60 °C and charged only below ~45 °C. On a
summer dashboard it would swell, wear out within months, and could catch fire inside the car.
A protection PCB doesn't fix that. LiFePO4 has safer chemistry but similar temperature limits.

Supercapacitors rated to 85 °C carry no fire risk and survive hundreds of thousands of cycles.
Their trade-off is low capacity: a full charge covers roughly a night of sleep plus a dozen or
so plays, and a few dark days parked in a garage empty them. That suits a car used in daylight.
The panel refills them in minutes of sun, and the board simply wakes up again once there's light.

## Parts list

| # | Part | Suggested part / spec | Approx. cost | Notes |
|---|---|---|---|---|
| 1 | Figure | Solar dancing Catrina toy (AliExpress 1005009364052577) | ~₪6 | Buy 2: one to open up first |
| 2 | MCU | ABRobot ESP32-C3 0.42" OLED board (already on hand) | — | Needs "USB CDC On Boot" enabled, same as `synth/` (frees GPIO20). Rated to 85 °C+ |
| 3 | Amp | MAX98357A I2S breakout (already on hand) | — | `SD` pin used for shutdown (< 2 µA when off). Rated to 85 °C |
| 4 | Speaker | 40 mm 4 Ω 3 W full-range | $3–5 | Behind a pattern of 3–4 mm holes in the enclosure front |
| 5 | Tap sensor | **SW-18010P** spring vibration switch + 1 MΩ pull-up to 3V3 | ~$1 | Normally open, so zero standby current. Glued rigidly to the underside of the lid, right below the doll |
| 6 | Doll driver feed | **150 Ω** resistor | <$1 | GPIO20 → toy's own driver circuit, in place of its solar cell |
| 7 | Solar panel | **9 V**, 1–2 W mono panel (~110×70 mm for 1 W) | $5–8 | Forms the enclosure lid. 9 V rather than 6 V, because a panel's voltage drops ~0.4 %/°C, and a hot 6 V panel can't reach 5 V |
| 8 | Regulator | **MP1584EN** mini buck module, adjusted to 5.0 V output | ~$1 | Input up to 28 V; efficient, so it doesn't add heat in a hot box |
| 9 | Blocking diode | **SS34** or 1N5819 Schottky | <$1 | Between buck output and the caps, so the caps can't back-feed the buck at night |
| 10 | Energy storage | **2 × 2.7 V 100 F supercapacitors, 85 °C rated**, in series (5.4 V, 50 F) | $4–8 | |
| 11 | Balancing | 2S supercapacitor balance/protection board | ~$1 | Keeps each cap ≤ 2.7 V. Often sold together with the caps |
| 12 | Supply sense | 2 × 1 MΩ resistors + 100 nF cap | <$1 | Divider into an ADC1 pin |
| 13 | Power switch | Small slide switch between caps and load | <$1 | |
| 14 | Enclosure | **Light-coloured** project box ~110×80×45 mm (or 3D-printed in white/light PETG or ASA, not PLA) | $3–5 | PLA softens at ~60 °C; a light box runs much cooler than a black one |
| 15 | Mounting | Non-slip dashboard pad or heat-rated double-sided tape (e.g. 3M VHB) | $2–4 | |
| 16 | Misc | 26–30 AWG wire, hot glue (high-temp sticks) | — | Regular hot glue softens around 60–70 °C |
| — | Fallback only | **AO3400** MOSFET + **1N4148** flyback diode + 100 kΩ gate pull-down | <$1 | Only if the toy's driver doesn't work from the ESP32 (see "Making her dance") |

## Modifying the doll

1. Open the purple base (usually clips or a couple of screws underneath). Inside: the solar
   cell, a tiny driver board (often a single blob-top chip or one transistor and a capacitor)
   and the coil. A magnet on a pendulum, fixed to the body, swings over the coil.
2. Desolder the solar cell. Solder two wires to its pads on the driver board, and note which
   pad is + (it's the cell's + side).
3. **Bench check** the driver from a bench supply through the 150 Ω resistor, at about 2 V and
   then 3.3 V: does she dance, and how much current does it draw? Note both here. Under
   ~20 mA, GPIO20 can feed it directly.
4. Drill a hole through the purple base's bottom and the enclosure lid. Route the two wires
   down, then glue the base onto the lid.
5. Check the dancing still swings freely with the base glued down.

## Wiring

| Signal | ESP32-C3 GPIO | Why this pin |
|---|---|---|
| I2S BCK / LRCK / DOUT | 4 / 7 / 10 | Unchanged from `synth/pins.h` |
| Vibration switch (to GND, 1 MΩ external pull-up, active low) | **1** | Deep-sleep-wake capable (0–5); not a strapping pin. The pull-up is external so it holds during deep sleep |
| Amp `SD` (shutdown) | **3** | Plain GPIO; held low through deep sleep with `gpio_hold_en()` |
| Supply sense (divider midpoint) | **0** | ADC1. Caps top out at ~4.7 V → 2.35 V at the pin, inside the 11 dB range |
| Doll driver feed (through 150 Ω) | **20** | Free once "USB CDC On Boot" is on (as in `synth/`); low at boot and in sleep, so she stays still |
| OLED | 5 / 6 | Hardwired; never initialized, so it stays dark |

Avoid GPIO2 and GPIO8/9 for anything that could be pulled low at boot (strapping pins).

Power path:

```
9 V panel ─► MP1584 buck (set 5.0 V) ─► SS34 ─► caps (2 × 100 F in series + balance board), ~4.7 V full
                                                 │
                                                 └─► slide switch ─┬─► board 5V pin (onboard LDO → 3V3)
                                                                   └─► MAX98357A VIN (2.5–5.5 V directly)
GPIO20 ─► 150 Ω ─► toy driver + (old solar-cell pad);  toy driver − ─► GND
3V3 ─► 1 MΩ ─┬─► GPIO1
             └─ SW-18010P ─► GND
caps + ─► 1 MΩ ─┬─► GPIO0   (+100 nF to GND)
                └─ 1 MΩ ─► GND
```

Usable energy is between ~4.7 V (full, after the diode drop) and ~3.5 V, where the board's LDO
can no longer hold 3.3 V: ½ × 50 F × (4.7² − 3.5²) ≈ **250 J**.

Make sure empty caps charge back up after the car sits dark for days (Phase 5). The panel's
own current limit caps the inrush, so expect the buck to stutter until the caps rise a little.

## Making her dance

**Default: keep the toy's own driver.** GPIO20 high powers it through the 150 Ω resistor, and
the driver times its kicks to her swing by itself. A tap is what woke the board, so she's
already moving when power arrives, which helps these circuits start. Drive GPIO20 high for the
length of the tune and low afterward. She winds down within a few seconds.

**Fallback: drive the coil directly** if the toy's driver won't run at 3.3 V or starts
unreliably. Remove the toy's driver board and wire the coil to the caps through an AO3400 on
GPIO20, with a 1N4148 across the coil (cathode to +) and a 100 kΩ gate pull-down. Then kick the
coil for `KICK_MS` (~30–80 ms) once every `SWING_PERIOD_MS`, set to her natural swing period
as timed with a phone video. Kicking at the wrong rate fights the swing instead of building it.

## Power budget

| State | Draw | Energy |
|---|---|---|
| Deep sleep: C3 (~5 µA) + LDO quiescent (~40–60 µA) + vibration switch (0 µA, open) + amp shut down + divider (~2 µA) + cap leakage (~20–50 µA, higher when hot) | ~0.15 mA at ~4 V (measure — board LEDs may add more) | ~50 J/day |
| Playing: C3 active ~25 mA + amp at moderate volume ~150 mA avg + doll driver ~10 mA | ~185 mA × 20 s at ~4 V | ~15 J per play |

With ~250 J stored, a full charge covers a night parked plus roughly a dozen plays, or about 4
days of sleep with no plays. A 1 W panel puts ~0.8 W into the caps in direct sun (refill in ~5
min) and ~0.1–0.2 W through a windshield on an overcast day (refill in ~20–40 min).

If the board has an always-on power LED, remove it or cut its trace. In sleep it can draw more
than everything else combined.

## Firmware

New sketch folder `catrina/` (`catrina.ino` + `clip.h`), standalone like `player/`. It reuses
`player/wav_to_header.py` for the clip. Single pass per wake; no `loop()` work:

1. **Boot / wake.** Release the GPIO hold on `SD`. Read `esp_sleep_get_wakeup_cause()` (log it
   over USB-CDC when connected).
2. **Supply check.** Average a few ADC reads on GPIO0 × 2 for the cap voltage. A play draws
   ~15 J, about 0.1 V off full caps but more as they empty. Below `MIN_PLAY_V` (~3.7 V), skip
   playback and go to step 6; the panel recharges the caps.
3. **Tap or road?** A tap is a single jolt; road vibration keeps going. After waking, ignore
   the switch for ~0.5 s, so the tap's own rattle can settle. Then watch it for another ~1 s:
   - If it closes again in that window, it's driving: skip playback and go to step 6 in driving
     mode.
   - Separately, keep the times of the last 3 GPIO wakes in `RTC_DATA_ATTR` memory, timed with
     `gettimeofday()`, which keeps counting through deep sleep. If all 3 fall within 60 s,
     that's also driving.
4. **Play and dance.** Drive `SD` high and GPIO20 high (doll driver on). Start I2S at the
   clip's rate and play the clip once, with a short fade-out at the end to avoid a pop.
5. **Shut down.** GPIO20 low, `SD` low, end I2S.
6. **Re-arm and sleep.** `gpio_hold_en(SD)`, then one of:
   - **Normal**: wait until she has stopped swinging and the switch has read open (high)
     continuously for `QUIET_MS` (~2 s). The C3 wakes on a *level*, so arming while the switch
     is closed would wake it straight away. Then
     `esp_deep_sleep_enable_gpio_wakeup(1 << 1, ESP_GPIO_WAKEUP_GPIO_LOW)`.
     Ignore the switch while playing: the speaker and her dancing shake the box and will close it.
   - **Driving**: don't arm the switch. Use `esp_sleep_enable_timer_wakeup()` for
     `DRIVING_SLEEP_S` (~5 min), then check again on the next wake. The car stays quiet while
     moving, and the driver isn't distracted.

   Then `esp_deep_sleep_start()`.

**The tune.** Use a public-domain composition: *Cielito Lindo* (1882), *La Cucaracha* or
*Jarabe Tapatío* (traditional). Use a recording you made, or one with a CC0/public-domain
license; commercial recordings are copyrighted even when the song isn't. A 15–20 s clip at
22,050 Hz mono 16-bit is 660–880 KB. Build with the **Huge APP (3 MB)** partition scheme, or
use 16 kHz if it must fit the default 1.2 MB app partition.

## Mounting in the car

- **Never over an airbag panel.** Many passenger-side dashboards hide one; a figure there
  becomes a projectile. Keep it clear of the driver's view too.
- **Secure it** with the non-slip pad or VHB tape, so it doesn't slide or fly off under hard
  braking.
- Panel facing up toward the windshield. The speaker grille faces the cabin.

## Phases

1. **Doll teardown** (no ESP32 yet): open the base, remove the solar cell, and bench-check the
   driver through 150 Ω at 2 V and 3.3 V (see "Modifying the doll").
2. **Bench dance** (USB power): GPIO20 → 150 Ω → toy driver. Confirm she starts dancing
   reliably from a tap. If not, switch to the AO3400 fallback and tune `SWING_PERIOD_MS` and
   `KICK_MS`.
3. **Triggered playback** (USB power): a tap wakes it, the clip plays, she dances. Set a fixed
   volume (scale samples) loud enough without the speaker distorting. Check the sensitivity:
   a light tap on her or the lid should trigger. Adjust by moving the switch, or swap in a
   stiffer SW-18020P/SW-18030P.
4. **Driving detection** (USB power): shake the box continuously by hand, or hold it against a
   running washing machine or a phone on vibrate. It must stay silent and enter driving mode,
   while single taps still play. Tune the windows in step 3 of the firmware.
5. **Deep sleep**: add the firmware steps above. Measure sleep current with a multimeter in
   series with the caps. Target ≤ 0.2 mA; find and remove whatever's above that.
6. **Solar + supercaps**: wire the panel, buck (set to 5.0 V *before* connecting the caps),
   diode, caps and supply sense. Check:
   - The caps charge in sun and stop at ~4.7 V.
   - The low-supply skip works.
   - Fully drained caps recover on their own in light, without the ESP32 getting stuck in a
     brownout reset loop.
7. **Integration and heat test**: build into the light-coloured box and leave it on the
   dashboard through a hot afternoon. Log the cap voltage on each wake, and check afterward
   that nothing has softened, warped or come unglued.
8. **Optional extras** (only if wanted):
   - Rotate between 2–3 clips across wakes, using an `RTC_DATA_ATTR` counter.
   - Synthesize the melody with the synth's `SPREAD_TRUMPET`/`SPREAD_GUITAR` spreads instead
     of a recording.

## Open questions

- **Which tune, and how long?** Determines flash size / partition scheme.
