# Contributing to BaseMile

Thanks for taking the time to help. Bug reports, fixes, tests and small focused
features are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on
  the approach before you spend time on it.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the module map and conventions,
  and skim [`docs/adr/`](docs/adr/) for the decisions that shape the code.
- By contributing you agree that your work is licensed under the project's
  license, GPL-3.0-or-later, including the app store permission in
  [APP-STORE-EXCEPTION.md](APP-STORE-EXCEPTION.md).

## Setup

You need Node 20 and npm. For the native app you also need the Android SDK or
Xcode, because BaseMile uses native modules and does not run in Expo Go.

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

To run the app, build a development client once and then start Metro:

```bash
npm run android      # or: npm run ios
npm start
```

BaseMile is a mobile app for Android and iOS. Without a strap, turn on **Mock
HR source** in Settings, Data & developer (development builds only).

The default map tiles come from OpenFreeMap and need no key. The only build
variables are optional custom raster tiles (`EXPO_PUBLIC_MAP_TILE_URL`,
`EXPO_PUBLIC_MAP_ATTRIBUTION`). Copy `.env.example` to `.env.local` if you need
them. Never commit a real `.env` file.

## Making changes

1. Fork the repository and create a branch from `main`, named with a prefix:
   `feat-`, `fix-`, `docs-`, `refactor-`, `test-` or `chore-`, for example
   `fix-ble-reconnect`.
2. Keep each pull request focused on one thing.
3. Write commit messages as a single line: `prefix: description`, for example
   `fix: reconnect the strap after the phone wakes up`.
4. Add or update tests for logic changes. Pure modules in `lib/` should stay
   free of React, storage and network so they are easy to test.
5. Run `npm run typecheck`, `npm run lint` and `npm test` before you push. CI
   runs the same checks.
6. Add the SPDX header to new source files:

   ```ts
   // SPDX-License-Identifier: GPL-3.0-or-later
   ```

## Code guidelines

- TypeScript strict, no `any`. Validate data only at boundaries (BLE bytes,
  raw SQLite rows, network responses).
- Cross-module types belong in `types/index.ts`.
- Comments explain why, not what.
- The app is dark theme only and must stay usable one-handed while running.
- Keep the app fully local: no accounts, servers, sync or analytics. Data
  stays on the phone. A new network call needs a strong reason, must be
  optional and visible to the user, and must be listed in the README privacy
  section.
- Coach lines are original wording. Do not add quotes or catchphrases from
  books, podcasts or public figures.
- Use plain hyphens in user-visible text, not em or en dashes.

## Reporting bugs

Use the bug report template. Include your phone model, OS version, strap model
and, if you can, the steps to reproduce. Please remove any personal data
(locations, health data) from logs and exports before you attach them.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
taking part you agree to uphold it.
