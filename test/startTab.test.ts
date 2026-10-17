// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { RETURN_TO_RUN_AFTER_MS, shouldReturnToRunTab } from '@/lib/run/startTab';

describe('shouldReturnToRunTab', () => {
  it('sends a long absence on another tab back to Run', () => {
    expect(shouldReturnToRunTab(RETURN_TO_RUN_AFTER_MS, '/history')).toBe(true);
    expect(shouldReturnToRunTab(3 * 60 * 60_000, '/settings')).toBe(true);
    expect(shouldReturnToRunTab(RETURN_TO_RUN_AFTER_MS, '/run/abc123')).toBe(true);
  });

  it('leaves a quick app switch alone and never re-navigates onto Run', () => {
    expect(shouldReturnToRunTab(RETURN_TO_RUN_AFTER_MS - 1, '/history')).toBe(false);
    expect(shouldReturnToRunTab(60 * 60_000, '/run')).toBe(false);
  });
});
