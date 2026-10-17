// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenProps {
  children: ReactNode;
  /** Render children inside a ScrollView with default padding. */
  scroll?: boolean;
  /**
   * Skip applying the bottom safe-area inset. Defaults to `true` because
   * tab screens get their bottom inset from react-navigation's tab bar
   * and would otherwise be double-padded.
   *
   * Set to `false` for modal / full-screen / stack-pushed contexts where
   * no tab bar is present, so the last item clears the system gesture
   * indicator on Android edge-to-edge.
   */
  noBottomInset?: boolean;
  /**
   * Skip applying the top safe-area inset. Defaults to `false`. Use when
   * the screen renders its own header inside an inset-aware container.
   */
  noTopInset?: boolean;
  /** Tailwind classes forwarded to the inner content container. */
  className?: string;
}

const HORIZONTAL_PADDING = 16;
const VERTICAL_PADDING = 12;
const TAB_SCROLL_CLEARANCE = 64;

export function Screen({
  children,
  scroll = false,
  noBottomInset = true,
  noTopInset = false,
  className,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const topPadding = noTopInset ? 0 : insets.top;
  const bottomPadding = noBottomInset ? 0 : insets.bottom;
  const tabScrollClearance = scroll && noBottomInset ? TAB_SCROLL_CLEARANCE : 0;

  if (scroll) {
    // The top inset sits outside the ScrollView so scrolled content is
    // clipped below the status bar instead of running under the clock.
    return (
      <View
        className="flex-1 bg-bg"
        style={{
          paddingTop: topPadding,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        <ScrollView
          className={className}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: VERTICAL_PADDING,
            paddingBottom: bottomPadding + VERTICAL_PADDING + tabScrollClearance,
            paddingHorizontal: HORIZONTAL_PADDING,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      className={`flex-1 bg-bg ${className ?? ''}`}
      style={{
        paddingTop: topPadding + VERTICAL_PADDING,
        paddingBottom: bottomPadding + VERTICAL_PADDING,
        paddingLeft: insets.left + HORIZONTAL_PADDING,
        paddingRight: insets.right + HORIZONTAL_PADDING,
      }}
    >
      {children}
    </View>
  );
}
