# 0005: BLE is a lazy singleton with a settings-gated mock source

## Status

Accepted

## Context

`react-native-ble-plx` cannot be loaded at all in Expo Go: importing
it crashes module load. We need (1) a single owner of the GATT subscription
and reconnection loop because duplicate `monitorCharacteristicForService`
calls produce double events and orphaned subscriptions, and (2) a way to
develop against a fake HR stream when no strap is present (in a simulator,
on a plane, or while writing UI).

Storing the BLE manager in React state would re-create it across reloads and
would not survive screen unmount during a run. A module-level singleton is the
natural fit but we still must not import the native module where it is missing.

## Decision

`lib/ble/manager.ts` exports a single `bleManager` instance of
`BleManagerSingleton`. The actual `BleManager` from `react-native-ble-plx` is
acquired through a lazy `getManager()` that `require`s the module the first
time it is needed and caches the result; on import failure it sets
`managerUnsupported = true` and the singleton degrades gracefully.

`lib/ble/mock.ts` exports `mockHRSource`, a separate singleton that writes
into the same `useBleStore`. `lib/ble/index.ts` exports the `useEffectiveHRSource`
hook which reads `useSettingsStore.useMockHR` and at runtime either:

- mock ON: calls `bleManager.suspendForMock()` and starts the mock generator;
- mock OFF: detaches the mock and calls `bleManager.tryAutoReconnect()`.

`useEffectiveHRSource` is mounted exactly once in `app/_layout.tsx`.

## Consequences

- One subscription, one reconnect loop. Disconnects re-attach the listener
  inside `attemptReconnect` because GATT monitors do not survive a disconnect.
- The mock toggle is gated behind a Settings switch so a real strap is used
  in production builds. Flipping it mid-app cleanly swaps sources.
- Expo Go still loads the app; the store sits in `'unsupported'` state.
- Downstream consumers (`useHeartRate`, the run screen, the coach engine)
  cannot tell whether they are reading real or mock data; the seam is below
  them.
