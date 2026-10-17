# 0006: Cadence via Pedometer, not accelerometer-ML

## Status

Accepted

## Context

The coach wants to nudge cadence (steps per minute) toward a target band
(default 170 spm). Two viable sources: (1) read raw accelerometer data and
detect footstrikes via peak-finding or an ML classifier, or (2) use the OS
pedometer that Apple and Google already maintain with motion-coprocessor
support, exposed via `expo-sensors` `Pedometer.watchStepCount`.

Option 1 means owning a footstrike detector that has to work across phone
positions (hand-held, armband, pocket, vest), running surfaces, and stride
mechanics. That is a lot to maintain for a small project.

## Decision

`lib/sensors/cadence.ts` defines a `CadenceSource` interface with one
implementation, `PedometerCadenceSource`, backed by
`Pedometer.watchStepCount`. Cadence is computed from the rolling step-count
delta over a 30-second window, emitted at 1Hz with a 10s idle timeout (no
emission while standing still). Availability is cached after first probe.

A `useCadence(active)` hook drives the UI; the run screen passes the latest
spm into `coachEngine.tick(sample, ms, cadence)` so cadence cues live inside
the same coach pipeline as HR cues.

## Consequences

- We inherit OS-level step-count quality, including motion-coprocessor
  filtering on iOS. Bad readings while phone is in a backpack are tolerated.
- The engine has no opinion about how cadence is sourced; the
  `CadenceSource` interface is the seam, leaving room for a strap-based or
  watch-based implementation later.
- Idle/walking is detected (no step delta in 10s → null) so cadence cues
  don't fire during traffic-light stops.
- An accelerometer-ML implementation is not foreclosed but would have to be
  justified by a concrete failure of the pedometer source.
