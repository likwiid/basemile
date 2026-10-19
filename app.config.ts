// SPDX-License-Identifier: GPL-3.0-or-later
import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json holds the whole config. Store builds run on EAS, and the EAS project and
// owner come from the environment, so the repo is tied to no account. Forks set their
// own EAS_PROJECT_ID / EAS_OWNER, or build locally without either.
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EAS_PROJECT_ID;
  const owner = process.env.EAS_OWNER;
  return {
    ...config,
    ...(owner ? { owner } : {}),
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
  } as ExpoConfig;
};
