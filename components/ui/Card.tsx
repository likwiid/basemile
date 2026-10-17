// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from 'react';
import { View } from 'react-native';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <View
      className={`bg-bg-card/80 border border-bg-border/70 rounded-xl p-3 ${className ?? ''}`}
    >
      {children}
    </View>
  );
}
