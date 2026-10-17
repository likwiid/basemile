// SPDX-License-Identifier: GPL-3.0-or-later

import { Linking, Pressable, Text } from 'react-native';

export const OPEN_METEO_URL = 'https://open-meteo.com/';

interface OpenMeteoCreditProps {
  /** What the data is, e.g. "Weather" or "Elevation". */
  subject?: string;
  className?: string;
}

/**
 * Attribution required by Open-Meteo's CC BY 4.0 data licence. Shown wherever
 * weather or DEM elevation from Open-Meteo appears.
 */
export function OpenMeteoCredit({ subject = 'Weather', className }: OpenMeteoCreditProps) {
  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => {
        void Linking.openURL(OPEN_METEO_URL).catch(() => undefined);
      }}
      className={className}
    >
      <Text className="text-text-muted text-[10px]">
        {subject} data by <Text className="underline">Open-Meteo.com</Text>
      </Text>
    </Pressable>
  );
}
