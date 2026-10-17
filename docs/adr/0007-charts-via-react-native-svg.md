# 0007: Charts rendered with raw `react-native-svg`

## Status

Accepted

## Context

The history screen needs HR-over-time charts, zone pie / bar distributions,
weekly Z2 bars, MAF drift / VDOT / decoupling trends, training-load CTL/ATL,
and HRV trend lines. Two off-the-shelf options exist: `victory-native` (a
charting framework) and `@shopify/react-native-skia` (a low-level GPU canvas
that several charting libraries layer on top of).

`victory-native` is large, opinionated, and has historically bundled poorly
with Expo / Metro on each major React Native upgrade. Skia's install footprint
is significant and forces a custom render pipeline for what are, fundamentally,
small static SVGs over already-aggregated data. The data sets are tens to a
few hundred points, not thousands.

`react-native-svg` is small, supported by Expo out of the box and enough for
these charts.

## Decision

All charts in `components/history/*` and run-screen visualisations are written
as plain function components that emit `<Svg>` with `<Path>`, `<Line>`,
`<Rect>`, `<Circle>`, `<G>`, and `<Text>` from `react-native-svg`. Layout is
done via `onLayout` to capture container width; scaling math lives directly
in each chart component. No charting framework dependency.

## Consequences

- Each chart owns its scale logic and draws what it draws: easy to read, easy
  to modify, no framework idioms to learn.
- Zero risk from charting-library upgrades during Expo SDK bumps.
- Some duplication of axis / scale code across charts. Acceptable at the
  current count; if we cross ~15 charts a small `useChartScale` helper may
  earn its keep, but no charting framework.
- Sample counts above a few thousand may force pre-aggregation. Already true
  in practice (`lib/metrics/*` aggregates before rendering).
