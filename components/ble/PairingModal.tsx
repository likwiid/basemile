// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { bleManager } from '@/lib/ble/manager';
import {
  useBleBattery,
  useBleError,
  useBleState,
  useBleStore,
  useDevice,
  useHeartRate,
} from '@/lib/ble/store';
import type { BleDevice } from '@/types';

interface PairingModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The Modal renders its children only while shown (and, on iOS, until the
 * dismiss animation ends), so the content and its live HR subscription
 * mount on open and unmount on close instead of re-rendering at 1 Hz while
 * hidden. Each open starts from fresh state.
 */
export function PairingModal({ visible, onClose }: PairingModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <PairingContent visible={visible} onClose={onClose} />
    </Modal>
  );
}

function PairingContent({ visible, onClose }: PairingModalProps) {
  const insets = useSafeAreaInsets();
  const connectionState = useBleState();
  const device = useDevice();
  const error = useBleError();
  const { bpm } = useHeartRate();
  const battery = useBleBattery();

  const [discovered, setDiscovered] = useState<BleDevice[]>([]);

  const stopAndClose = useCallback(() => {
    bleManager.stopScan();
    if (connectionState === 'error') {
      useBleStore.getState().setState('idle');
    }
    onClose();
  }, [onClose, connectionState]);

  useEffect(() => {
    if (!visible) {
      bleManager.stopScan();
      setDiscovered([]);
    }
  }, [visible]);

  // On Android the Modal drops this content as soon as it is hidden, before
  // the visible effect above can see `false`, so stop any scan on unmount too.
  useEffect(() => () => bleManager.stopScan(), []);

  const handleScan = useCallback(() => {
    setDiscovered([]);
    void bleManager.startScan((d) => {
      setDiscovered((prev) => (prev.some((p) => p.id === d.id) ? prev : [...prev, d]));
    });
  }, []);

  const handlePick = useCallback((d: BleDevice) => {
    bleManager.stopScan();
    void bleManager.pair(d.id);
  }, []);

  const handleUnpair = useCallback(async () => {
    await bleManager.unpair();
    onClose();
  }, [onClose]);

  const view = useMemo<ViewState>(() => {
    if (connectionState === 'connected') return 'connected';
    if (connectionState === 'connecting') return 'connecting';
    if (connectionState === 'scanning') return 'scanning';
    if (connectionState === 'error') return 'error';
    if (connectionState === 'unsupported') return 'unsupported';
    if (connectionState === 'poweredOff') return 'poweredOff';
    if (connectionState === 'reconnecting') return 'reconnecting';
    return 'idle';
  }, [connectionState]);

  return (
    <View
      className="flex-1 bg-bg"
      style={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left + 24,
        paddingRight: insets.right + 24,
      }}
    >
      <View className="flex-row justify-between items-center mb-8">
        <Text className="text-text-primary text-2xl font-semibold">Pair HR Strap</Text>
        <Pressable
          onPress={stopAndClose}
          className="h-14 w-14 items-center justify-center rounded-full bg-bg-card"
        >
          <Text className="text-text-primary text-xl">×</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {view === 'idle' && <IdleView onScan={handleScan} />}
        {view === 'scanning' && <ScanningView devices={discovered} onPick={handlePick} />}
        {view === 'connecting' && <ConnectingView name={device?.name ?? 'device'} />}
        {view === 'reconnecting' && (
          <ReconnectingView name={device?.name ?? 'device'} />
        )}
        {view === 'connected' && (
          <ConnectedView
            name={device?.name ?? 'HR Strap'}
            bpm={bpm}
            battery={battery}
            onUnpair={handleUnpair}
          />
        )}
        {view === 'error' && (
          <ErrorView message={error?.message ?? 'Something went wrong'} onRetry={handleScan} />
        )}
        {view === 'unsupported' && <UnsupportedView />}
        {view === 'poweredOff' && <PoweredOffView />}
      </ScrollView>
    </View>
  );
}

type ViewState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'error'
  | 'unsupported'
  | 'poweredOff';

function IdleView({ onScan }: { onScan: () => void }) {
  return (
    <View>
      <Card className="mb-6">
        <Text className="text-text-primary text-base mb-2">No strap paired</Text>
        <Text className="text-text-secondary text-sm leading-5">
          Put on your Bluetooth heart rate strap, wet the electrodes and stand within 1 m of
          the phone so it wakes up. Then tap below to scan. Any strap that uses the standard
          Bluetooth Heart Rate profile should work; ANT+ only straps and Apple Watch do not.
        </Text>
      </Card>
      <Button title="Scan for straps" onPress={onScan} size="lg" />
    </View>
  );
}

function ScanningView({
  devices,
  onPick,
}: {
  devices: BleDevice[];
  onPick: (d: BleDevice) => void;
}) {
  return (
    <View>
      <View className="flex-row items-center mb-4">
        <ActivityIndicator color="#10b981" />
        <Text className="text-text-primary text-base ml-3">Scanning…</Text>
      </View>
      {devices.length === 0 ? (
        <Card>
          <Text className="text-text-secondary text-sm">
            Looking for heart rate sensors. Hold still and keep the strap near the phone.
          </Text>
        </Card>
      ) : (
        devices.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => onPick(d)}
            className="bg-bg-card rounded-2xl p-4 mb-3 min-h-14 active:opacity-70"
          >
            <Text className="text-text-primary text-lg font-semibold">
              {d.name ?? 'Unknown device'}
            </Text>
            <Text className="text-text-secondary text-xs mt-1">{d.id}</Text>
            {typeof d.rssi === 'number' && (
              <Text className="text-text-muted text-xs mt-0.5">RSSI {d.rssi} dBm</Text>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

function ConnectingView({ name }: { name: string }) {
  return (
    <Card className="items-center py-8">
      <ActivityIndicator size="large" color="#10b981" />
      <Text className="text-text-primary text-lg mt-4">Connecting to {name}…</Text>
    </Card>
  );
}

function ReconnectingView({ name }: { name: string }) {
  return (
    <Card className="items-center py-8">
      <ActivityIndicator size="large" color="#10b981" />
      <Text className="text-text-primary text-lg mt-4">Reconnecting to {name}…</Text>
      <Text className="text-text-secondary text-sm mt-2 px-6 text-center">
        Make sure your strap is on and within range.
      </Text>
    </Card>
  );
}

function ConnectedView({
  name,
  bpm,
  battery,
  onUnpair,
}: {
  name: string;
  bpm: number | null;
  battery: number | null;
  onUnpair: () => void;
}) {
  return (
    <View>
      <Card className="mb-4">
        <Text className="text-accent text-sm font-semibold mb-1">Paired ✓</Text>
        <Text className="text-text-primary text-xl font-semibold">{name}</Text>
      </Card>
      <Card className="mb-4 flex-row items-center justify-between">
        <Text className="text-text-secondary text-sm">Live HR</Text>
        <Text className="text-text-primary text-3xl font-bold">
          {bpm !== null ? `${bpm}` : '--'}
          <Text className="text-text-secondary text-base"> bpm</Text>
        </Text>
      </Card>
      <Card className="mb-6 flex-row items-center justify-between">
        <Text className="text-text-secondary text-sm">Battery</Text>
        <Text className="text-text-primary text-lg font-semibold">
          {battery !== null ? `${battery}%` : '--'}
        </Text>
      </Card>
      <Button title="Unpair" onPress={onUnpair} variant="danger" size="md" />
    </View>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View>
      <Card className="mb-6">
        <Text className="text-zone-z5 text-sm font-semibold mb-2">Pairing failed</Text>
        <Text className="text-text-primary text-base">{message}</Text>
      </Card>
      <Button title="Retry" onPress={onRetry} size="lg" />
    </View>
  );
}

function UnsupportedView() {
  return (
    <Card>
      <Text className="text-text-primary text-base mb-2">Bluetooth not available</Text>
      <Text className="text-text-secondary text-sm leading-5">
        BLE pairing requires a development build on iOS or Android. Toggle Mock HR in Settings to
        try the app without a strap.
      </Text>
    </Card>
  );
}

function PoweredOffView() {
  return (
    <Card>
      <Text className="text-text-primary text-base mb-2">Bluetooth is off</Text>
      <Text className="text-text-secondary text-sm leading-5">
        Turn Bluetooth on in your device settings, then come back to pair.
      </Text>
    </Card>
  );
}
