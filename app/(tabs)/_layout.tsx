// SPDX-License-Identifier: GPL-3.0-or-later

import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { RUN_TAB_PATH, shouldReturnToRunTab } from '@/lib/run/startTab';
import { zoneColor } from '@/lib/zones';

const THEME = {
  active: zoneColor(2),
  inactive: '#525252',
  bg: '#000000',
  border: '#1f1f1f',
} as const;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabIconProps {
  color: string;
  size: number;
}

const icon = (name: IoniconName) => {
  function TabIcon({ color, size }: TabIconProps) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

/**
 * Coming back to the app after a long absence lands on Run, even though
 * Android kept the process (and the last tab) alive in the background.
 */
function useReturnToRunAfterAbsence(): void {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let backgroundedAt: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundedAt = Date.now();
        return;
      }
      if (next !== 'active' || backgroundedAt === null) return;
      const awayMs = Date.now() - backgroundedAt;
      backgroundedAt = null;
      if (shouldReturnToRunTab(awayMs, pathnameRef.current)) router.navigate(RUN_TAB_PATH);
    });
    return () => sub.remove();
  }, [router]);
}

export default function TabsLayout() {
  useReturnToRunAfterAbsence();
  return (
    <Tabs
      initialRouteName="run"
      // Back from any tab returns to Run and Back on Run leaves the app, so
      // the task is parked on Run. The default ('firstRoute') targeted the
      // hidden index redirect: Back on Run bounced through it, and Back from
      // History parked the task on History, which the next launch reopened.
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        // Blurred tabs stop re-rendering (react-native-screens freeze), so
        // store writes during a run do not repaint History, Routes or
        // Settings off screen. Focus listeners stay subscribed, so each
        // screen's useFocusEffect reload still runs when it is opened.
        freezeOnBlur: true,
        tabBarActiveTintColor: THEME.active,
        tabBarInactiveTintColor: THEME.inactive,
        tabBarStyle: {
          backgroundColor: THEME.bg,
          borderTopColor: THEME.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="run"
        options={{
          title: 'Run',
          // Never freeze Run: its effects and timers drive the live run and
          // coach cues while another tab is open.
          freezeOnBlur: false,
          tabBarAccessibilityLabel: 'Start a run',
          tabBarIcon: icon('play-circle'),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarAccessibilityLabel: 'Run history',
          tabBarIcon: icon('time'),
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: 'Routes',
          tabBarAccessibilityLabel: 'Route heat map',
          tabBarIcon: icon('map'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarAccessibilityLabel: 'Settings',
          tabBarIcon: icon('settings'),
        }}
      />
    </Tabs>
  );
}
