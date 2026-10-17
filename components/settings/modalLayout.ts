// SPDX-License-Identifier: GPL-3.0-or-later

import type { EdgeInsets } from 'react-native-safe-area-context';

/**
 * Shared className for the outer container of full-screen test modals
 * (BaselineTestModal, Co2TestModal, HrvTestModal, MaxHRTestModal).
 *
 * The content padding is layered on via `style` because it must
 * compose with safe-area insets that come from the device.
 */
export const MODAL_CONTAINER_CLASS = 'flex-1 bg-bg justify-between gap-6';
export const MODAL_BUTTON_CLASS = 'w-full max-w-md self-center';

const MODAL_CONTENT_PADDING = 20;

/**
 * Build the inline style object that pads a test-modal container with safe
 * area insets plus the shared content gutter.
 */
export function modalContainerStyle(insets: EdgeInsets) {
  return {
    paddingTop: insets.top + MODAL_CONTENT_PADDING,
    paddingBottom: insets.bottom + MODAL_CONTENT_PADDING,
    paddingLeft: insets.left + MODAL_CONTENT_PADDING,
    paddingRight: insets.right + MODAL_CONTENT_PADDING,
  } as const;
}
