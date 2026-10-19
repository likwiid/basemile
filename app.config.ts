// SPDX-License-Identifier: GPL-3.0-or-later
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins';

// expo-notifications adds the push entitlement, but BaseMile only schedules local
// notifications. Dropping it keeps the build from needing a push-enabled profile.
const withoutPushEntitlement: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });

// app.json holds the whole config. Store builds run on EAS, and the EAS project and
// owner come from the environment, so the repo is tied to no account. Forks set their
// own EAS_PROJECT_ID / EAS_OWNER, or build locally without either.
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EAS_PROJECT_ID;
  const owner = process.env.EAS_OWNER;
  return withoutPushEntitlement({
    ...config,
    ...(owner ? { owner } : {}),
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
  } as ExpoConfig);
};
