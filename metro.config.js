// SPDX-License-Identifier: GPL-3.0-or-later

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Zustand's ESM middleware uses `import.meta.env`, which Metro cannot serve in
// a classic script. Prefer React Native/CommonJS export conditions so packages
// resolve to their runtime-safe entrypoints.
config.resolver.unstable_conditionNames = ['react-native', 'require', 'default'];

module.exports = withNativeWind(config, { input: './global.css' });
