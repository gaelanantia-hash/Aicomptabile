# AICOM

Accounting software modelled on the three Sage 100 modules (sales management, point of sale, accounting), shipped as an installable desktop app. Each customer signs in with their own Google account and their data live in their own Google Drive; the developer's backend (`../licensing`) handles licences and updates only.

Project documentation, in Italian, is in [`../../docs`](../../docs).

## Run

```sh
npm install
npm run dev            # interface in the browser, demo mode with sample data, nothing saved
npm run desktop        # build and open the desktop app
npm run desktop:dev    # desktop app on top of `npm run dev`
```

Started from this folder without `desktop.config.json`, the desktop app runs in development mode: no licence required and a "continue without Google" shortcut. The local-only status is clickable: with Google configured it starts sign-in; otherwise it opens the development settings. The installed app never offers the local-only shortcut.

In development mode, the **Actualiser / Refresh** button in the app reloads the interface. With `npm run desktop:dev`, interface changes are also picked up by Vite; changes to the Electron main process still require restarting the desktop app.

## Layout

| Path | What |
|---|---|
| `src/` | React interface. `SageModules.tsx` holds the 27 activity screens and `sageData.ts` their business rules; `FinanceSections.tsx` and `financeData.ts` the workspace sections (overview, supplier invoices, bank matching, month-end close, cash forecast, data quality, help); `DesktopApp.tsx` the desktop shell (setup wizard, sync status, audit trail, settings) |
| `electron/` | Desktop main process: Google sign-in (OAuth + PKCE), Drive client, local SQLite database, sync engine, licence check, auto-update |
| `tests/`, `electron/*.test.ts` | Automated tests, run against an in-memory stand-in for Google |
| `server/`, `CLOUD_DEPLOYMENT.md` | Earlier hosted-web architecture, not used by the desktop app |

## Checks

```sh
npm run lint
npm test
npm run build:desktop
npm run dist           # Windows installer in release/
```

## Configuration

The publisher configures Google OAuth and the licence/update services once in `desktop.config.json` before building the installer; see `docs/02-google-cloud.md`. Customers only choose their Google account in the browser opened by AICOM. The config file is bundled into the installer and must contain nothing confidential: never add service-account keys.

The AICOM symbol is used in the application header and window; `build/aicom.ico` supplies the Windows installer and executable icon.
