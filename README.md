# Tokyo Drive — Teltonika AVL playground

A low-poly 3D driving game with an original sports coupe around Shibuya, Tokyo, plus a separate Teltonika TCP receiver with persistent trip history, interactive map trails and driving-event detection. Node.js **22 or later** is required; no dependency installation or API key is needed.

## Start both programs

In the first terminal:

```sh
npm run receiver
```

The receiver listens on **localhost:5027** for native Teltonika TCP. Open **http://localhost:8788** for its trip dashboard.

In another terminal:

```sh
npm start
```

Open **http://localhost:8787** for the car. Leave the destination as `localhost:5027` to use the bundled receiver; the sample IMEI is `356307042441013`. Click **Connect & send AVL**, turn the engine on, drive, then turn it off. The receiver dashboard shows the completed trip, its trail, speed and event markers. Different IMEIs have separate histories. To use your existing receiver instead, change the destination host/port and enter an IMEI it accepts.

| Command | Purpose |
|---|---|
| `npm start` | Browser game and TCP bridge, HTTP 8787 |
| `npm run receiver` | Independent TCP receiver 5027 and dashboard HTTP 8788 |
| `npm run receiver:demo` | Original minimal console-only test receiver |
| `npm test` | Geometry, driving physics, codec, TCP, history and storage tests |
| `npm run build` | Prepare trimmed map geometry and build static preview |
| `npm run map:refresh` | Download the small OSM extract and prepare its geometry |

Use `PORT=9001 npm start` to change the game HTTP port. Use `RECEIVER_PORT=9000 RECEIVER_HTTP_PORT=9002 npm run receiver` to change receiver ports. Both servers bind to loopback. The bundled receiver accepts any 15-digit IMEI and is intended as a local development receiver.

## Drive and trigger events

- **W / up**: accelerate. **S / down**: brake, then reverse.
- **A / D / left / right**: steer. **Space**: handbrake.
- **Hold Shift** or the **Nitro** button: boost to **160 km/h**, consuming a five-second charge. It recharges while not boosting; release Shift to rearm after depletion. Normal driving is capped at 80 km/h; releasing boost slows excess speed gradually.
- **I**: ignition on/off. **P**: pause. **C**: camera. **R**: return the car to its starting road.
- **M** or **Sound on/off**: mute/unmute the procedural engine, road, tyre, nitro, collision and checkpoint sounds. The coupe has a deep, throaty procedural exhaust note with virtual gear shifts. Audio begins after a driving click/key, follows engine speed, and silences while paused or the page is in the background. The sound preference is remembered in this browser. No audio files or extra dependencies are downloaded.
- Touch controls appear on narrow screens. Three checkpoints offer a small exploration challenge.

For an event test, connect while the engine is off, turn it on, hold Shift for 2–3 seconds on a clear road, press Space, then turn the engine off. With default receiver thresholds, this produces speeding, harsh acceleration and harsh braking.

## Trip history and rules

A complete trip has an observed **off → on → off** ignition sequence (IO 239). Its time and trail start at ignition-on and end at the next ignition-off; the preceding off observation is retained as `previousOffAt`. Ignition-off idle records do not create trips. A first record with the engine already on creates a trip marked **start not observed**. Disconnecting does not finish a trip. Trips with missing ignition values retain their last known ignition state. Records are ordered by AVL timestamp, and exact retransmissions are deduplicated; late records rebuild the history in time order.

The dashboard provides device filtering, active/completed trip selection, pan/zoom, fit-to-trail, replay, clickable event markers, trip statistics and JSON history export. The bundled OSM basemap covers Shibuya; GPS trails outside that extract can still be displayed, without detailed basemap coverage.

Default receiver rules are editable in the dashboard:

| Rule | Default |
|---|---|
| Test speed threshold | 60 km/h |
| Harsh braking | 3 m/s² |
| Harsh acceleration | 4 m/s² |
| Maximum GPS sample gap for acceleration estimates | 10 seconds |

The speed threshold is a configurable **test value**, not a lookup of legal road limits. Speeding emits one event per episode, with 3 km/h hysteresis. Harsh-event episodes are latched and have a two-second cooldown. Rule changes apply to new records; historical records retain the rules in effect when they were received.

The receiver estimates acceleration/deceleration from consecutive GPS speeds and their actual millisecond timestamp difference. It skips estimates across excessive time gaps, invalid fixes and ignition-off transitions. It also handles Teltonika Green Driving events: IO 253 type 1/2/3 and IO 254 magnitude. The simulator emits high-priority type 1/2 events for sustained harsh acceleration/braking, independent of the normal sending interval. Event rows distinguish **Device IO** from **GPS estimate**; reported events without magnitude are displayed as such. GPS estimates describe speed changes and cannot distinguish braking from simulation resets, pauses or collisions. This is a test tool, not a calibrated driving-safety assessment.

History and rules are saved in `receiver/data/history.ndjson` (ignored by Git). Packets are acknowledged only after their journal entry is flushed to disk. Restarting recovers trips/rules; a torn final write is discarded. Set `RECEIVER_DATA_FILE=/absolute/path/history.ndjson` to use a different log. The receiver decoder validates CRC, record counts, IO counts, timestamps and GPS fields, and supports Codec 8 and 8E including variable-length IO. Unsupported or malformed frames close the connection and appear in API diagnostics.

## Geometry and telemetry

The OSM extract is preserved in `web/data/shibuya.json`. `scripts/prepare-map.mjs` subtracts rendered road and sidewalk corridors from building polygons, keeping remaining parts and courtyard holes in `world.json`. The 3D view and collision system use the same prepared polygons. Collision tests include the whole rotated car rectangle and sample its swept path at 25 cm intervals; blocked moves retain the previous position and heading. The bundled-map regression test checks that building footprints do not overlap any driving corridor.

The browser uses a same-origin Node bridge to open a persistent TCP connection. It sends the length-prefixed ASCII IMEI and waits for acceptance, then sends Codec 8/8E packets and validates four-byte record-count acknowledgements. Count mismatches retry the identical packet up to three times. A bounded queue preserves ignition and event records while a packet is in flight. Delivery failures stop transmission and are visible in the UI; disconnect/reconnect to retry. There is no automatic offline replay, and unacknowledged records remain available in the browser's local JSON export. The browser journey itself is in memory and is cleared on refresh.

Records contain UTC Unix milliseconds, real projected Shibuya coordinates encoded at 1e-7 degrees, speed in km/h, heading in degrees, synthetic altitude **32 m**, synthetic **12 satellites**, ignition IO **239**, movement IO **240**, odometer IO **16** in metres, and optional driving event IO **253/254**. The export is a normalized custom JSON schema, not an unspecified third-party simulator's input schema. This is not full FMC125 firmware: CAN/OBD, cellular state, UDP, Codec 12 commands, traffic and terrain elevation are not emulated. One-way roads and left-side lane discipline are not enforced.

The hosted version is a driving preview with a receiver-dashboard layout preview. **Native TCP and live receiver data require the local programs.** Browsers cannot open raw TCP sockets, and the hosting runtime does not support them.

## Open-source foundations

- [Three.js r170](https://github.com/mrdoob/three.js), MIT: renderer; vendored with its license.
- [Kontra.js 10.0.2](https://github.com/straker/kontra), MIT: fixed-step game loop; vendored with its license.
- [polygon-clipping 0.15.7](https://github.com/mfogel/polygon-clipping), MIT: map preparation; vendored in `scripts/` with its license.
- [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL: Shibuya street/building extract, about 1.6 × 1.7 km. In-game and dashboard attribution remain visible; see `web/data/LICENSE.md`.

There are no live map or tile requests during gameplay. Optional web fonts fall back to system fonts. Game physics, receiver, UI and Teltonika integration are custom code built on the above foundations.

Protocol references: [Teltonika Codec documentation](https://wiki.teltonika-gps.com/view/Codec), [Green Driving event format](https://wiki.teltonika-gps.com/view/Green_Driving_Solution), [FMC125 features](https://wiki.teltonika-gps.com/view/FMC125_Features_settings).
