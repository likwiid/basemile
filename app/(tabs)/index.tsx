// SPDX-License-Identifier: GPL-3.0-or-later

import { Redirect } from 'expo-router';

// The Run tab is the app's home; expo-router still wants an index route.
export default function IndexRedirect() {
  return <Redirect href="/run" />;
}
