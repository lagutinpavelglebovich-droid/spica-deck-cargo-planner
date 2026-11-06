# Decargo 3.43.0 — changes made after internal security review

Before submitting Decargo to Tidewater IT, I had the source code reviewed against what I told IT about the app. The review found the points below; all except one are fixed in version 3.43.0.

1. **More internet hosts than stated.** The app also looked up city names: it searched for a city from typed text and, after asking for the PC's location, found the city for that position.
   *Fixed:* city search, location lookup and the location prompt are removed. Weather uses only the platform coordinates in the cargo plan.
2. **No limit on where the app could connect.** Its Content Security Policy allowed any web address.
   *Fixed:* the app may now connect only to the two Open-Meteo hosts, and load map images only from OpenStreetMap and OpenSeaMap. Everything else is refused.
3. **The automatic update check could not be turned off.**
   *Fixed:* there is a new switch, "Check for updates automatically". An optional IT policy file, `%ProgramData%\Decargo\policy.json`, can lock updates, weather and maps on or off.
4. **An unused cloud-sync option remained in the app.** It was off by default, but it could send the plan to an external server and keep a password.
   *Fixed:* cloud sync is removed, and any saved credentials are deleted on first start. The two bridge PCs sync only through a shared folder on the ship's network.
5. **The installer claimed all `.json` files.**
   *Fixed:* only `.spica` is registered, and upgrading from an older version gives `.json` back to the program that had it before.
6. **Copies of Outlook attachments were left in the temp folder.**
   *Fixed:* only the attachment being imported is copied, and it is deleted straight after reading. The temp folder is also cleared at start-up and at exit. Outlook access remains read-only.
7. **Third-party Rust components had not been checked for known vulnerabilities.**
   *Fixed:* they were checked with `cargo audit`. The TLS libraries (rustls, webpki) and several other components were updated. The remaining advisories either do not apply to the Windows build or affect only the signed update package, and are documented in the audit report. The JavaScript components have no known vulnerabilities (`npm audit`).
8. **Not fixed yet: the installer is not code-signed (Authenticode).** Windows shows "unknown publisher". The SHA-256 of the installer is provided so the file can be verified, and the automatic update package is cryptographically signed.

Unchanged and confirmed by the review: cargo data stays on the PC, Outlook is read-only, there is no telemetry, there are no open ports, and the licence check is offline.

— Pavlo Lagutin, Chief Officer, SPICA TIDE
