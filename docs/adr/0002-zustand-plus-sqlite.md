# 0002: Zustand for state, SQLite for history

## Status

Accepted

## Context

The app has two distinct storage needs. **Live state** during a run (current
HR, zone, GPS buffer, run status) changes many times a second and must be cheap
to subscribe to from React. **Run history** is append-mostly, queried by date
ranges and grows without bound: HR samples alone produce about 3,600 rows per
hour-long run.

Redux is heavyweight for a small app and forces boilerplate around trivial
setters. AsyncStorage alone would not cope with the volume of HR samples. A
remote database is ruled out by ADR 0001.

## Decision

Use Zustand for all in-memory and small persisted state, one store per
concern (`useActiveRunStore`, `useBleStore`, `useProfileStore`,
`useSettingsStore`, `useNotificationStore`). Persist with
`zustand/middleware/persist` over AsyncStorage where it makes sense. Keep
transient state (live samples, run buffers) unpersisted.

Use SQLite (`expo-sqlite`) for run history and high-volume time series:
`runs`, `hr_samples`, `gps_points`, `cadence_samples`, `routes`, `baselines`,
`hrv_samples` and `co2_samples`.
The schema lives in `lib/storage/db.ts`. Aggregate at query time, not at write
time.

## Consequences

- The data layer is split: settings live in AsyncStorage, history in SQLite.
  Both stay on the phone.
- HR samples are stored at full 1 Hz fidelity. Charts and metrics aggregate on
  the fly. This keeps the write path simple but means trend queries scan many
  rows; acceptable at the data volumes one runner produces.
- Zustand stores are small and easy to grep for.
