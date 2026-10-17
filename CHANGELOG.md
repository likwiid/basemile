# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-17

First public release.

### Added

- Three run types (Long, Medium, Brief) with heart rate targets from your
  profile, warm-up handling and interval guidance (30/60 repeats or a 4x4).
- Live heart rate from any standard Bluetooth Heart Rate profile strap, with
  zones, MAF ceiling alerts and an escalating over-ceiling warning.
- Spoken coach using the phone's own text-to-speech, plus Voice Mode: a
  hands-free screen that holds a strict heart-rate band, with optional sports
  psychology cues.
- GPS distance, pace, splits and route maps; cadence from the phone's
  pedometer.
- Run detail with HR chart, zone distribution, splits, elevation profile,
  grade-adjusted pace, aerobic decoupling and run context notes.
- History trends: MAF pace and MAF-GAP drift, weekly Zone 2 minutes, training
  load (CTL, ATL, TSB), VDOT, decoupling and HRV.
- Automatic detection of repeated routes, a heat map of everywhere you run and
  per-route history with MAF-GAP drift.
- Resting HR, max HR, HRV and breath-hold tests.
- Single-run JSON and GPX export through the share sheet.
- Setting to turn off the Open-Meteo weather and elevation lookups.
- Fully local: no account, no server, no sync. Data stays on the phone; the
  only network use is the optional weather and elevation lookups and the map
  tiles.
