# Tokyo Drive — Teltonika AVL playground

A small, low-poly 3D driving game around Shibuya, Tokyo. Drive through real OpenStreetMap streets and send the car's GPS position to your Teltonika receiver using native TCP Codec 8 (default) or Codec 8 Extended.

## Run locally

Requires **Node.js 22 or later**. No dependency installation or API keys are needed.

```sh
npm start
```

Open **http://localhost:8787**. In the telemetry panel, set your receiver's host and TCP port, enter an IMEI your receiver accepts, choose the codec and interval, and click **Connect & send AVL**. Defaults are `localhost:5027` and the sample IMEI `356307042441013`; replace them as appropriate. The car and locally recorded points work before connecting.

For a quick demonstration without your own receiver, run this in a second terminal:

```sh
npm run receiver
```

This starts a development receiver at `localhost:5027`, validates the frame CRC and acknowledges records. Stop it before starting your own receiver on that port. Its console shows IMEI, coordinates and speed. Use `RECEIVER_PORT=9000 npm run receiver` or `PORT=9001 npm start` to change listening ports.

## Drive

- W / up: accelerate; S / down: brake, then reverse.
- A / D or left / right: steer. Space: handbrake.
- C: chase/city camera. R: return the car to the starting road.
- I: ignition. P: pause driving (zero-speed telemetry continues).
- Touch controls appear on narrow screens.
- Find the three orange checkpoints, or explore freely.

The minimap, speedometer and telemetry panel follow the car. JSON export saves recorded points with millisecond UTC timestamps, decimal latitude/longitude, GPS fields and typed IO values. The exported schema is documented in `web/app.js`; it is a normalized simulator format, not a claim of compatibility with an unspecified third-party simulator's JSON input. Refreshing the page clears the in-memory journey.

## Transport and profile

The browser talks to the same-origin Node bridge. The bridge opens a persistent TCP socket to the receiver, sends the length-prefixed ASCII IMEI, waits for `0x01`, then sends AVL packets. It validates each four-byte record-count acknowledgement before reporting delivery. Count mismatches retransmit the identical packet, up to three attempts. Connection/ACK timeouts close the socket and are shown in the UI. There is one packet in flight at a time. Points captured while that packet is pending are still recorded locally but skipped for delivery. After a failure, disconnect and reconnect; there is no automatic offline replay. Delivery counters represent acknowledgements, not merely socket writes.

Coordinates use a local geographic projection tied to real Shibuya coordinates; car speed is converted from metres/second to km/h and heading is degrees clockwise from north. Both codecs include:

| Field | Value |
|---|---|
| Timestamp | Unix milliseconds, real wall-clock time |
| GPS latitude / longitude | Current car coordinates, encoded at 1e-7 degrees |
| Speed / heading | Calculated from simulated motion |
| Altitude / satellites | Synthetic constants: 32 m / 12 |
| IO 239 (1 byte) | Ignition 0/1; toggling ignition emits an event record |
| IO 240 (1 byte) | Movement 0/1 |
| IO 16 (4 bytes) | Distance travelled in metres |

This is a useful receiver test device, not complete FMC125 firmware. It does not model cellular connectivity, device configuration, CAN/OBD peripherals, Codec 12 commands, UDP, terrain elevations, street traffic or GPS loss. Buildings use OSM footprints with tagged or deterministic approximate heights. Arcade driving permits either direction; one-way traffic and left-side lanes are not enforced. Buildings and map bounds stop the car; off-road movement is slower.

The hosted version is a driving/recording preview. **Native TCP requires the local app at localhost:8787**, because browsers cannot connect directly to raw TCP and the hosting runtime does not support it. The local bridge binds only to loopback and accepts same-origin requests.

## Open-source foundations and map data

- [Kontra.js 10.0.2](https://github.com/straker/kontra), MIT: the fixed-step game loop. Vendored locally with its license.
- [Three.js r170](https://github.com/mrdoob/three.js), MIT: the low-poly renderer. Vendored locally with its license.
- [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL 1.0: bundled Shibuya street and building extract. In-game attribution stays visible. See `web/data/LICENSE.md`.
- [JavaScript Racer](https://github.com/jakesgordon/javascript-racer) was evaluated as a game base. Its fixed pseudo-3D racing track is less suitable for free movement across real streets, so no Racer code or assets are incorporated. Driving physics, UI, world generation and Teltonika integration here are custom, built on the two MIT libraries above.

The bundled map covers 35.6525–35.668 N, 139.692–139.710 E (about 1.6 × 1.7 km). There are no tile downloads during gameplay. Optional `npm run map:refresh` fetches this bounded extract from the OSM API; refresh infrequently. The geometry converter and bounds are in `scripts/`. The game runs without network access once local assets are loaded; web fonts gracefully fall back to system fonts.

## Verification and building

```sh
npm test
npm run build
```

Tests check the official Codec 8 example byte for byte, CRC-16/IBM, the IMEI handshake, signed coordinates, Codec 8E IO widths, fragmented ACKs, retransmission, rejection and timeouts. The app was also driven in the browser against the included test receiver. The static build is copied to `dist/`; the Node bridge runs directly from source. The bridge and test receiver use only Node's built-in modules.

Protocol references: [Teltonika Codec documentation](https://wiki.teltonika-gps.com/view/Codec), [FMB/FMC family IO parameters](https://wiki.teltonika-gps.com/view/Template:FMB_Device_Family_Parameter_list).
