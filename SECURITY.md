# Security policy

## Supported versions

Security fixes go into the latest release on the `main` branch.

## Reporting a vulnerability

Please do not open a public issue for security problems. Email
[hello@likwiid.com](mailto:hello@likwiid.com) with:

- what you found and where (file, screen or endpoint);
- steps to reproduce, or a proof of concept;
- the impact you expect.

You should get a reply within a week. Once a fix is ready we will publish it
and credit you in the release notes, unless you prefer to stay anonymous.

## Scope

BaseMile stores health and location data on the device. Reports about the
following are especially welcome:

- data leaving the device other than the documented Open-Meteo lookups and
  map tile requests;
- what the weather and elevation requests send, and whether the Settings
  switch really stops them;
- Bluetooth handling of malformed heart rate packets;
- the files written when a run is shared as JSON or GPX.

The app has no server, account or sync, so there is no backend to report on.
