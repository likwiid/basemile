// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Hex constants mirroring the Tailwind palette in `tailwind.config.js`.
 * Kept here so SVG `stroke` / `fill` props (which can't take Tailwind classes)
 * stay aligned with the rest of the design system.
 *
 * If a token in `tailwind.config.js` changes, update the matching value here.
 */
export const CHART_COLORS = {
  // bg.border — used for grid lines
  grid: '#1f1f1f',
  // text.muted — used for axis labels and zero-line guides
  axisText: '#525252',
  // text.primary — used for the main HR trace
  trace: '#fafafa',
} as const;

/** Shared className for the "not enough data" placeholder in chart cards. */
export const CHART_EMPTY_CLASS =
  'bg-bg-elevated/35 border border-bg-border/60 rounded-xl items-center justify-center px-4';
