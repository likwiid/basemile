# 0004: Coach engine is a pure, side-effect-free state machine

## Status

Accepted

## Context

The coach has to make many time-sensitive decisions (zone exceeded, interval
phase transitions, scream-mode escalation, periodic check-ins, fueling,
cadence nudges, pre-run readiness cue, interval blocks). If these
decisions were entangled with React state, audio dispatch, or wall-clock time,
they would be hard to test and prone to subtle bugs around pause/resume,
re-renders, and audio queue ordering.

Running the engine off `runElapsedMs` (monotonic, paused-time excluded) rather
than `Date.now()` makes pause/resume correct by construction and makes test
playback deterministic.

## Decision

The coach engine in `lib/coach/engine.ts` exports `createCoachEngine(config)`
which returns `{ tick(sample, runElapsedMs, cadence?), finish(runElapsedMs),
getState() }`. `tick` returns an array of `CoachCue` values and performs no
I/O. The engine maintains internal `CoachState` plus a `cueHistory` log used
for cooldown deduplication.

Audio is a separate concern: `lib/coach/audio.dispatchCue(cue, verbosity)`
consumes cues and speaks them with the phone's own text-to-speech
(`expo-speech`). The run screen (`app/(tabs)/run.tsx`) calls
`tick` on each HR sample and dispatches the
returned cues asynchronously, so audio never blocks the HR pipeline.

## Consequences

- The engine is unit-testable end-to-end by feeding a synthetic sample stream
  and asserting on the cue array. No mocking of speech or audio required.
- Adding a new cue kind is a local change inside `engine.ts` plus a string in
  `CoachCueKind`. Audio dispatch needs no edit.
- The pause/resume contract is enforced upstream: the integrator must not
  advance `runElapsedMs` while paused. Violating that breaks cooldown logic.
- Scream mode, fueling, and cadence cues each maintain their own dedup gates
  inside the engine for reasons documented inline; bypasses of `cueHistory`
  are intentional and load-bearing.
