# 0003: Run types instead of a fixed training plan

## Status

Accepted

## Context

Earlier builds generated a fixed multi-week schedule of sessions, first with
lifting days and then cardio only. In practice the schedule rarely matched
real life: a missed day shifted everything, rest days had to be inferred, and
much of the UI existed only to show where the runner was in the plan.

## Decision

There is no training plan. Before each run the runner picks one of three run
types from `lib/run/runTypes.ts`:

- **Long**: continuous Zone 2 under the MAF ceiling (the default).
- **Medium**: a short warm-up, then a sustained block at a higher heart-rate
  band.
- **Brief**: a warm-up, then intervals (30 s on and 60 s off, or a 4x4).

Each run type arms a `Session` that the coach engine follows. Older stored
values of `runs.type` (from the plan era) are folded onto the three ids by
`normalizeLegacyRunType()` and an idempotent `UPDATE` in `initDb`.

## Consequences

- No scheduling state to keep in sync; history is the record of what happened.
- Weekly Zone 2 volume is shown as a trend in History rather than as plan
  compliance.
- A structured plan could return later as an optional layer on top of run
  types, but would need its own ADR.
