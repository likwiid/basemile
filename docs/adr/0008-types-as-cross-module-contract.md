# 0008: `types/index.ts` is the single shared type contract, append-only

## Status

Accepted

## Context

The codebase is split into modules (`lib/ble`, `lib/coach`, `lib/metrics`,
`lib/run`, `lib/storage`, `lib/notifications` and others) that were often
developed in parallel. If each module exported its own cross-cutting types,
two changes could land conflicting definitions of `HRSample`, `Session`,
`CompletedRun` and so on at the same time.

Tests, screens, and metrics all consume the same wire-shape values
(`CompletedRun`, `Session`, `HRSampleRecord`, `ReadinessScore`,
`TrainingLoadPoint`). A single shared file makes the contract greppable and
breaking changes loud.

## Decision

`types/index.ts` holds every cross-module type. Pure types only: no runtime
code, no Zod schemas, no functions. All cross-module imports go through
`@/types`. Module-private types stay inside the module.

The file is treated as **append-only**: new types are added freely, but
renames or shape changes to existing types require deliberate review because
they ripple across the entire codebase. The file is sectioned by domain
(`Heart Rate & Zones`, `BLE`, `User profile`, `Run types / sessions`,
`Run / History`, `Elevation`, `Coach engine`, `Active run state`,
`Trends / Analytics`, `Notifications`, `HRV & Readiness`, `Training load`,
`Aerobic decoupling`, `VO2max / VDOT`, `Mock HR`, `CO2 tolerance`,
`Run context / injury risk`).

## Consequences

- Cross-module contracts have one source of truth. Grepping a type name finds
  exactly one definition.
- The file grows monotonically. That's the trade.
- Module-private types must stay private; leaking them into `types/index.ts`
  pollutes the contract.
- Schema-style validation (Zod) lives at the boundaries (BLE bytes, raw
  SQLite rows from non-typed queries), not in this file.
- Renames are intentionally expensive; that cost is the point.
