// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Run is the app's start screen. Android keeps the process alive after Home
 * (and after Back, which only moves the task to the background), so a launch
 * from the icon an hour later resumes whatever tab was last open. After a
 * long enough absence we treat the return like a fresh start and go to Run.
 */
export const RETURN_TO_RUN_AFTER_MS = 10 * 60_000;

export const RUN_TAB_PATH = '/run';

export function shouldReturnToRunTab(awayMs: number, pathname: string): boolean {
  return awayMs >= RETURN_TO_RUN_AFTER_MS && pathname !== RUN_TAB_PATH;
}
