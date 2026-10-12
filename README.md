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

Open **http://localhost:8787** for the car. Leave the destination as `localhost:5027` to use the bundled receiver; the sample IMEI is `356307042441013`. Click **Connect & send AVL**, turn the engine on, drive, then turn it off. Click **Send now** to flush the completed trip immediately, or wait for the configured upload interval. The receiver dashboard shows the completed trip, its trail, speed and event markers. Different IMEIs have separate histories. To use your existing receiver instead, change the destination host/port and enter an IMEI it accepts.

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

## Autonomous trips

Under the game, choose **0.1–100 km** and click **Start autonomous trip**. Leave all event boxes unchecked for a calm run, or select **Harsh acceleration**, **Speeding** and/or **Harsh braking**. Each selection runs once. Events require at least **0.5 km**; higher speed thresholds need longer trips, and the form reports the required minimum. Match the **test speed limit** to the receiver rule (default **60 km/h**).

This is a scripted road-following simulator. It builds a graph from the bundled OSM roads, prunes dead ends and narrow streets, rounds junctions, and checks the full car footprint along the route before starting. Long trips repeat a connected road loop within the small map. Every moving frame still checks collision. It starts a new trip near the Shibuya starting road, records an ignition-off baseline, turns the engine on, drives the requested route distance, decelerates, then turns the engine off. The dashboard odometer remains cumulative; autonomous progress shows the distance for this run. A running manual trip is ended before the new autonomous trip begins.

Calm runs cruise at up to **35 km/h**, below the chosen test threshold, with acceleration up to **1.8 m/s²**, braking up to **1.5 m/s²**, and lower approach speeds for bends. Selected harsh tests use **6 m/s²** acceleration and **8 m/s²** braking. Speeding accelerates gently to **20 km/h above the test limit**, holds briefly, and returns to cruise. These profiles trigger the default receiver rules; custom receiver thresholds can change which events it detects. Events are measured from the actual simulated motion and use the same GPS/AVL and Green Driving event stream as manual driving. An extra sample at the scenario peak helps receivers see the event even with a long normal sampling interval.

**Pause / P** holds position, progress and autonomous sampling; resume continues the same trip. Switching browser tabs pauses it automatically until you return, so keep the game tab visible while a run is in progress. **Stop trip** or ignition-off ends the trip early. Driving keys or touch controls take over manually and keep the same trip open; turn the engine off to finish it. Reset ends the autonomous trip before relocating the car. Receiver delivery status remains visible, and local JSON recording and buffering work without a receiver.

## Device timing and faster test data

**Device timing** separates acquisition from transmission, using independent engine-on/off profiles. Defaults are:

| Profile | Collect every | Upload every |
|---|---|---|
| Engine on | 2 simulated seconds | 300 simulated seconds (5 minutes) |
| Engine off | 300 simulated seconds (5 minutes) | 3600 simulated seconds (1 hour) |

Choose **Live** for 2-second driving uploads, **Device** for the above batching at real time, or **Fast test** for the same device profile at **12×**. Customize each interval from **1–86,400 seconds** and simulation speed from **1–30×**, then click **Apply timing**. At **6×**, ten real minutes produces one simulated hour; at **12×**, five real minutes does. Use long autonomous runs (up to **100 km**) for extended driving data.

GPS timestamps and collection/upload deadlines follow the accelerated clock. Manual driving, steering, braking, nitro and camera response stay at their normal real-time pace at every multiplier. Autonomous driving still uses 60 Hz substeps in simulated time and accelerates with the clock. The dashboard shows the car’s driving speed. For manual driving, AVL speed is divided by the clock multiplier and acceleration by its square, keeping telemetry and driving events consistent with GPS positions and simulated timestamps. At 12×, an 80 km/h dashboard speed therefore records about 7 km/h in AVL. Use autonomous trips for full-speed telemetry over the accelerated timeframe. The clock starts at page load and may advance into future wall-clock timestamps during accelerated runs; the current AVL date/time is displayed.

Ignition transitions and driving events are captured immediately in addition to scheduled samples, and wait for the next upload batch. Changing ignition switches profile and resets both deadlines. The **pending** counter and simulated/real countdowns show what is buffered and when it will upload. Ending a trip switches to the engine-off schedule, so click **Send now** to view its completed history immediately. Connecting also flushes the existing backlog. Manual sends reset the current upload deadline.

Collection works offline; pending records survive delivery errors and disconnect/reconnect in the same tab. Uploads split into packets of at most ten records, stay below the 1280-byte profile limit, and retain acquisition timestamps. Records leave the buffer only after a complete receiver ACK. To retry a failed upload, disconnect and reconnect. Once a buffer is associated with an IMEI, that IMEI is held until its pending records have been acknowledged. The buffer holds 100,000 records; a full buffer pauses the simulation until uploads free space. Local JSON keeps the latest 100,000 points and includes the active timing settings.

**Pause** and hidden tabs hold driving, the simulated clock, and collection; uploads already in flight may finish. Keep the game visible for accelerated runs. Background bridge heartbeats are HTTP-only and do not create fake AVL records; authenticated receiver connections support long idle upload periods. Browser recordings and pending records are held in memory and cleared on refresh. Export before reloading.

The chase camera uses elapsed-time smoothing for both its position and aim, car heading eases through turns, and keyboard steering eases in/out. Smoothed car poses still pass the full building collision check. No camera shake effect is added.

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

The browser uses a same-origin Node bridge to open a persistent TCP connection. It sends the length-prefixed ASCII IMEI and waits for acceptance, then sends Codec 8/8E packets and validates four-byte record-count acknowledgements. Count mismatches retry the identical packet up to three times. A bounded buffer preserves acquired records until they are acknowledged, including ignition and event records. Transmission follows the active engine profile; disconnect/reconnect or Send now flushes the backlog. Delivery failures stop transmission and retain pending records. The browser journey and upload buffer are in memory and cleared on refresh.

Records contain UTC Unix milliseconds, real projected Shibuya coordinates encoded at 1e-7 degrees, speed in km/h, heading in degrees, synthetic altitude **32 m**, synthetic **12 satellites**, ignition IO **239**, movement IO **240**, odometer IO **16** in metres, and optional driving event IO **253/254**. The export is a normalized custom JSON schema, not an unspecified third-party simulator's input schema. This is not full FMC125 firmware: CAN/OBD, cellular state, UDP, Codec 12 commands, traffic and terrain elevation are not emulated. One-way roads and left-side lane discipline are not enforced.

The hosted version is a driving preview with a receiver-dashboard layout preview. **Native TCP and live receiver data require the local programs.** Browsers cannot open raw TCP sockets, and the hosting runtime does not support them.

## Open-source foundations

- [Three.js r170](https://github.com/mrdoob/three.js), MIT: renderer; vendored with its license.
- [Kontra.js 10.0.2](https://github.com/straker/kontra), MIT: fixed-step game loop; vendored with its license.
- [polygon-clipping 0.15.7](https://github.com/mfogel/polygon-clipping), MIT: map preparation; vendored in `scripts/` with its license.
- [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL: Shibuya street/building extract, about 1.6 × 1.7 km. In-game and dashboard attribution remain visible; see `web/data/LICENSE.md`.

There are no live map or tile requests during gameplay. Optional web fonts fall back to system fonts. Game physics, receiver, UI and Teltonika integration are custom code built on the above foundations.

Protocol references: [Teltonika Codec documentation](https://wiki.teltonika-gps.com/view/Codec), [Green Driving event format](https://wiki.teltonika-gps.com/view/Green_Driving_Solution), [FMC125 features](https://wiki.teltonika-gps.com/view/FMC125_Features_settings).
