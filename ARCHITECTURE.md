# Architecture

BaseMile is an Expo (SDK 55) React Native app for Android and iOS, written in
strict TypeScript. It is fully local: no account, no server, no sync. Everything
lives on the phone, and the only network use is the optional weather and
elevation lookups and the map tiles (see
[ADR 0001](docs/adr/0001-fully-local-no-backend.md)).

This file is the map of the codebase and the shared vocabulary. The
load-bearing decisions are recorded in [`docs/adr/`](docs/adr/), and the coach's
cue rules are in [`docs/coach-spec.md`](docs/coach-spec.md).

## Stack

| Concern | Choice |
|---|---|
| App framework | Expo SDK 55, React Native 0.83, expo-router |
| Styling | NativeWind (Tailwind classes), dark theme only |
| State | Zustand, persisted to AsyncStorage where needed |
| History | SQLite through expo-sqlite |
| Heart rate | react-native-ble-plx, standard Bluetooth Heart Rate service (0x180D) |
| Location and steps | expo-location, expo-sensors Pedometer |
| Maps | MapLibre React Native with OpenFreeMap vector tiles (no key) |
| Charts | react-native-svg, hand-written components |
| Voice | expo-speech (the phone's own text-to-speech) |
| Tests | Vitest (node environment) |

## Module map

```
app/                    expo-router screens
  (tabs)/run            pre-run picker, live run, Voice Mode
  (tabs)/history        trends and the run list
  (tabs)/routes         repeated routes and the route heat map
  (tabs)/settings       profile, zones, tests, coach options, data
  run/[id]              run detail
  routes/[id]           route detail
  soak                  voice pipeline soak test (deep link only)
components/             UI, namespaced by feature (run, history, map, settings, ble, ui)
lib/
  ble/                  BLE manager singleton, HR parser, mock HR source, store
  sensors/              cadence from the OS pedometer
  run/                  active run store, run types, distance, splits, weather, launch maintenance
  coach/                coach engine, psych cue bank, Voice Mode logic, audio pipeline, voice log
  metrics/              pure analytics (MAF, decoupling, load, HRV, VDOT, terrain, trends)
  elevation/            DEM elevation correction and per-route canonical profiles
  route/                route matching, heat tracks, route intelligence
  storage/              SQLite schema and queries, profile and settings stores
  export/               single-run JSON and GPX, shared through the share sheet
  notifications/        post-run summary notification
  config/               online lookup switch
config/                 constants (BLE UUIDs, storage keys, DB name) and the default profile
modules/run-keepalive/  small native module: Android foreground service during runs
types/index.ts          the shared type contract (ADR 0008)
test/                   Vitest suites
```

| Layer | Responsibilities | Talks to |
|---|---|---|
| `app/` | Screens, hook composition, layout | `lib/*`, `components/*` |
| `components/` | UI only, namespaced by feature | `lib/zones`, `lib/time`, `@/types` |
| `lib/metrics`, `lib/coach/engine`, `lib/run/runTypes` | Pure logic, no React and no I/O | `@/types` |
| `lib/storage` | SQLite schema and queries, persisted stores | expo-sqlite, AsyncStorage |
| `lib/ble` | One GATT subscription and reconnect loop | react-native-ble-plx |
| `lib/coach/audio` | Serializes spoken cues | expo-speech |

## Heart rate pipeline

The hot path during a run:

```
Bluetooth HR strap (Heart Rate service 0x180D)
  │ raw notifications via react-native-ble-plx
  ▼
lib/ble/parser.parseHRMeasurement → HRSample { bpm, timestamp, rr? }
  ▼
lib/ble/manager (singleton, throttled to 1 Hz)
  ▼
lib/ble/store.useBleStore
  ├─> useHeartRate() → HR display (1 Hz repaint)
  └─> run screen effect
        ├─> useActiveRunStore.pushSample (zone classification, buffers)
        └─> coach engine.tick(sample, runElapsedMs, cadence) → CoachCue[]
              ▼
            lib/coach/audio.dispatchCue (async, never blocks the HR path)
              ▼
            on-device text-to-speech (expo-speech)
```

With **Mock HR** switched on (Settings, development builds only),
`useEffectiveHRSource` suspends the real manager and a generator writes into
the same store, so nothing downstream can tell the difference
([ADR 0005](docs/adr/0005-ble-lazy-singleton-with-mock-toggle.md)).

GPS runs in parallel: `expo-location` callbacks land in
`useActiveRunStore.pushGps`, which keeps distance incrementally and a rolling
pace window. Cadence comes from the OS pedometer
([ADR 0006](docs/adr/0006-cadence-via-pedometer-not-accelerometer-ml.md)).

At the end of a run the store produces a `CompletedRun`, which is written to
SQLite with its HR samples, GPS points and cadence samples, and matched to a
known route (or a new one is created). When the run is opened, and at launch
for runs still missing it, the app fetches terrain elevation (if online
lookups are on) and recomputes ascent and grade-adjusted pace.

## Coach

- `lib/coach/engine.ts` is a pure state machine: `tick()` takes a sample and
  returns cues, with cooldowns and dedup kept internally
  ([ADR 0004](docs/adr/0004-coach-engine-pure-state-machine.md)).
- `lib/coach/voiceMode.ts` holds the strict heart-rate band logic behind Voice
  Mode (in, below, above, no signal).
- `lib/coach/psychCues.ts` holds the sports psychology cue bank and the pure
  weighted picker. Scheduling rules are in `docs/coach-spec.md`.
- `lib/coach/audio.ts` serializes speech through the phone's own
  text-to-speech (`lib/coach/deviceTts.ts`). An urgent cue cuts in; others
  queue.
- `lib/coach/voiceLog.ts` keeps a small log of the speech pipeline in a file on
  the phone for debugging (the `soak` screen reads it). It never leaves the
  device.

## Domain vocabulary

### Heart rate and zones

- **HR sample**: `HRSample` from `@/types`, `{ bpm, timestamp, rr?, energy? }`.
- **Zone**: one of `z1` to `z5`, computed from max HR and resting HR (Karvonen)
  or edited manually in Settings. The runtime classifier is `classifyHR` in
  `lib/zones.ts`.
- **Z2**: Zone 2, the aerobic base zone and the main target of Long runs.
- **MAF**: Maximum Aerobic Function. `mafCeiling = 180 - age + adjustment`.
  The ceiling for easy running; the coach warns when HR crosses it.
- **MAF pace**: average pace while HR sits in a 5 bpm window just under the
  ceiling, the headline aerobic efficiency trend.
- **Scream mode**: escalated alerts when HR runs well above the ceiling.

### Training load and readiness

- **TRIMP**: training impulse, one dose number per run.
- **CTL / ATL / TSB**: chronic load (42-day EWMA of TRIMP), acute load (7-day
  EWMA) and their balance. Negative TSB means fatigue. See `lib/metrics/load.ts`.
- **HRV / RMSSD**: resting heart rate variability from RR intervals, measured
  with a strap that reports them. See `HrvRecord`.
- **Baseline**: a stored resting or max HR test result.

### Performance

- **VDOT**: Daniels' VO2max-equivalent score. See `lib/metrics/vdot.ts`.
- **Aerobic decoupling**: drift between first-half and second-half pace to HR
  efficiency on a steady run. See `lib/metrics/decoupling.ts`.
- **GAP**: grade-adjusted pace, from DEM-corrected elevation when available.
- **Cadence (spm)**: steps per minute over a rolling 30 s window.

### Run types

There is no training plan ([ADR 0003](docs/adr/0003-run-types-instead-of-a-fixed-plan.md)).
Before each run the runner picks **Long** (continuous Zone 2, the default),
**Medium** (warm-up, then a sustained higher band) or **Brief** (warm-up, then
30/60 intervals or a 4x4). `Session` objects come only from
`sessionForRunType()` in `lib/run/runTypes.ts`. `Session.warmup_sec` gates band
verdicts: nothing says "above" or "below" until the warm-up ends.

## State stores (Zustand)

| Store | File | Persisted | Holds |
|---|---|---|---|
| `useProfileStore` | `lib/storage/profile.ts` | yes (`basemile:profile:v1`) | `UserProfile`, MAF adjustment; re-derives zones on update |
| `useSettingsStore` | `lib/storage/settings.ts` | yes (`basemile:settings:v1`) | Coach, Voice Mode, cadence, fueling and lookup preferences |
| `useBleStore` | `lib/ble/store.ts` | device only (`basemile:ble:v1`) | Connection state, paired device, last sample, battery |
| `useActiveRunStore` | `lib/run/store.ts` | no | The run in progress |
| `useNotificationStore` | `lib/notifications/store.ts` | yes | Notification permission status |

Every AsyncStorage key starts with `basemile:`.

## Storage (SQLite)

Database file: `basemile.db`. The schema lives in `lib/storage/db.ts`; `initDb`
runs idempotent `CREATE TABLE IF NOT EXISTS` and small migrations on start.

| Table | Purpose |
|---|---|
| `runs` | One row per completed run, with splits, zone distribution, weather and context as JSON columns |
| `hr_samples` | Every HR sample at 1 Hz, joined to a run |
| `gps_points` | Every GPS fix, with ground elevation once corrected |
| `cadence_samples` | Cadence over time |
| `routes` | Detected repeated routes and their canonical elevation profile |
| `baselines` | Resting and max HR test results |
| `hrv_samples` | RMSSD measurements |
| `co2_samples` | Breath-hold test results |

The data never leaves the phone on its own: there is no account, no server and
no sync, and Android's cloud backup is off for the app (`allowBackup: false` in
`app.json`). The run detail screen can share one run as JSON or GPX
(`lib/export/runExport.ts`, `lib/export/gpx.ts`, `lib/export/share.ts`) through
the system share sheet, only when the runner taps it.

## Network calls

The app contacts only these public third parties:

- **Open-Meteo** (`api.open-meteo.com`): current weather at run start
  (`lib/run/weather.ts`) and DEM elevation for a finished run's GPS points
  (`lib/elevation/dem.ts`). Both send coordinates. Turn them off in Settings,
  Data & developer, "Weather and elevation" (`lib/config/lookups.ts`).
- **OpenFreeMap** (`tiles.openfreemap.org`): map tiles and label fonts, loaded
  by MapLibre (`components/map/maplibre.ts`). No key and no account. Replace
  the tiles with a raster provider through `EXPO_PUBLIC_MAP_TILE_URL` and
  `EXPO_PUBLIC_MAP_ATTRIBUTION`. These are the only build variables the app
  reads.

## Maps

Run routes and the live map use `@maplibre/maplibre-react-native` with a
trimmed copy of OpenFreeMap's dark style (`components/map/openFreeMapDark.ts`,
picked in `components/map/maplibre.ts`). The style is inline rather than a
remote style URL, so the background and the run track still draw with no
network; only the vector tiles and label glyphs come from
`tiles.openfreemap.org`, and no sprite sheet is loaded. A raster `{z}/{x}/{y}`
provider can replace it at build time (see `.env.example`). MapLibre is a
native module, so a JS reload is not enough after
changing native dependencies: run `npx expo prebuild --clean` and rebuild the
development build.

## Conventions

- TypeScript strict, no `any`. Validate only at external boundaries (BLE bytes,
  raw SQLite rows, network responses).
- Functional components and hooks. Classes only for the BLE singleton and the
  cadence source.
- Absolute imports through `@/...`.
- Cross-module types go in `types/index.ts`; module-private types stay private.
- Small pure modules in `lib/`; screens compose them. Keep pure logic free of
  React, storage and network so it can be unit tested.
- HR UI updates at 1 Hz. Audio never blocks the HR pipeline.
- Dark theme only, using the NativeWind tokens (`bg-bg`, `bg-bg-card`,
  `text-text-primary`, `text-zone-z2` and so on).
- Big tap targets (at least 56 dp on the run screen). The run screen must work
  one-handed.
- Comments explain why, not what.
- User-visible strings use plain hyphens for ranges ("136-154"), never em or en
  dashes (a test enforces this for run type copy).
- Read every `EXPO_PUBLIC_*` variable as a static `process.env.EXPO_PUBLIC_X`
  access; Expo only inlines that form.
- No new network calls, accounts or servers. The app is local only.
