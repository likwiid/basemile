// SPDX-License-Identifier: GPL-3.0-or-later

import { Pressable, Text } from 'react-native';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'lg' | 'xl';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  className?: string;
}

const VARIANT_BG: Record<Variant, string> = {
  primary: 'bg-accent',
  secondary: 'bg-bg-elevated/60 border border-bg-border',
  danger: 'bg-zone-z5/90',
};

const VARIANT_TEXT: Record<Variant, string> = {
  primary: 'text-black',
  secondary: 'text-text-primary',
  danger: 'text-white',
};

// Keep the visual chrome compact while preserving a 44dp+ touch target.
const SIZE_BOX: Record<Size, string> = {
  md: 'min-h-11 px-4 py-2',
  lg: 'min-h-12 px-5 py-2',
  xl: 'min-h-14 px-6 py-3',
};

const SIZE_TEXT: Record<Size, string> = {
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-lg',
};

const DISABLED_ACCESSIBILITY_STATE = { disabled: true } as const;

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={disabled ? DISABLED_ACCESSIBILITY_STATE : undefined}
      hitSlop={6}
      className={`${VARIANT_BG[variant]} ${SIZE_BOX[size]} ${
        disabled ? 'opacity-45' : 'active:opacity-75'
      } rounded-xl items-center justify-center ${className ?? ''}`}
    >
      <Text className={`${VARIANT_TEXT[variant]} ${SIZE_TEXT[size]} font-medium`}>
        {title}
      </Text>
    </Pressable>
  );
}
