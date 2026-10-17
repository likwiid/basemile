// SPDX-License-Identifier: GPL-3.0-or-later

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareTextFile({
  filename,
  contents,
  mimeType,
}: {
  filename: string;
  contents: string;
  mimeType: string;
}): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(contents);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType,
      dialogTitle: filename,
      UTI: mimeType === 'application/gpx+xml' ? 'com.topografix.gpx' : undefined,
    });
  } else {
    throw new Error('Sharing is not available on this device');
  }
}
