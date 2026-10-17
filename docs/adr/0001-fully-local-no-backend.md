# 0001: Fully local, no backend

## Status

Accepted

## Context

BaseMile is a training app for one runner on one phone. There are no growth,
retention or monetisation requirements. A backend would mean accounts, auth,
server hosting, privacy review and a product surface to maintain. Health data
is among the most sensitive categories, so keeping it on the device sidesteps a
whole class of problems.

## Decision

The app stores everything on the device: SQLite for run history and
AsyncStorage for persisted settings. There are no accounts, no analytics, no
server and no sync. Notifications are scheduled locally with
`expo-notifications`. The coach speaks with the phone's own text-to-speech
engine. Android's cloud backup is switched off for the app
(`allowBackup: false`).

The only network calls are public third-party lookups that the user can see
and control: Open-Meteo for weather and terrain elevation (can be turned off in
Settings) and OpenFreeMap for map tiles (no key, replaceable through
`EXPO_PUBLIC_MAP_TILE_URL`). A single run leaves the phone only when the runner
shares it as JSON or GPX through the system share sheet.

## Consequences

- Features prefer on-device computation. Metrics modules (`lib/metrics/*`)
  operate over data read from SQLite.
- Losing or resetting the phone loses the data. There is no whole-history
  export or restore.
- No PII handling, no auth code paths and no GDPR surface.
- Multi-user features, social features, sync or a hosted service would each
  require reopening this ADR.
