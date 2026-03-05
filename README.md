# Cloudup Desktop App

A native macOS menu bar app that wraps the Cloudup web app with native OS integrations. The webview IS the app — native code only handles OS integration while auth and uploads flow through the web app.

## Features

- **Menu bar tray icon** with visual state indicators (idle / uploading / error)
- **Screenshot auto-detection** watches `~/Desktop` and `~/Pictures/Screenshots` for new screenshots; opt-in on first detection via a permission dialog
- **Drag-and-drop** files onto the tray icon to upload (multiple files go to the same stream)
- **Bulk upload confirmation** asks before uploading more than 5 files at once
- **Window auto-opens** on upload so you can see progress inline in the web app
- **Native notifications** for errors (file too large, offline, server unreachable) and auto-update readiness
- **Auto-login prompt** opens the login page on first launch if not logged in
- **Offline detection** with a fallback page and automatic reconnection
- **Auto-updater** checks for new versions on startup and every 4 hours (production only)
- **Preferences** via right-click tray menu: "Open at Login" and "Auto-Stream Screenshots" toggles

For architecture details and implementation notes, see [docs/plans/webview-desktop-app.md](../../docs/plans/webview-desktop-app.md).

## Prerequisites

- Node.js 20 LTS (see root `.nvmrc`; Node 25+ has compatibility issues with electron-builder)
- npm
- The Cloudup web app must be running (for development) or accessible (for production)

## Quick Start

```bash
# from the root of cloudup-mono
make up
make cloudup-js:build
cd apps/desktop
npm install
npm run dev
```

## Development

### Local Development (cloudup.test)

For development against your local Cloudup instance:

```bash
npm run dev
```

This runs against `https://cloudup.test` with self-signed certificate support enabled for trusted domains (`*.cloudup.test`, `*.cldup.test`, `*.minio.test`).

### Staging

```bash
npm run stage
```

Runs against `https://stage-cloudup.com`.

### Production Mode

To run against production `https://cloudup.com`:

```bash
npm run prod
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Build and run against local cloudup.test |
| `npm run stage` | Build and run against staging |
| `npm run prod` | Build and run against production |
| `npm run build` | Compile TypeScript and write build-env.json (for packaging) |
| `npm run start` | Run without rebuilding |
| `npm run pack` | Build unpacked directory (for debugging) |
| `npm run dist` | Package for distribution |
| `npm run dist:mac` | Package for macOS (production config) |
| `npm run dist:mac:stage` | Package for macOS with staging config |
| `npm run dist:win` | Package for Windows |
| `npm run clean` | Remove build output |

Packaged builds bake in the environment: `dist:mac` uses production (cloudup.com); `dist:mac:stage` uses staging (stage-cloudup.com). The packaged app then uses that config even when launched by double-click (no env vars required).

### Make Targets

These wrap the npm scripts from the repository root:

| Target | Description |
|--------|-------------|
| `make desktop` | Install deps and build |
| `make desktop:install` | Install dependencies |
| `make desktop:build` | Compile TypeScript |
| `make desktop:dev` | Build web app and run against cloudup.test |
| `make desktop:stage` | Run against staging |
| `make desktop:prod` | Run against production |
| `make desktop:start` | Run without rebuilding |
| `make desktop:dist` | Package for distribution |
| `make desktop:dist:mac` | Package macOS DMG |

Note: `make desktop:dev` automatically runs `make cloudup-js:build` first, since the desktop app depends on the web app's `__cloudup_uploader__` export.

## Environment Configuration

The app uses the `CLOUDUP_ENV` environment variable (at dev time) or a baked-in `dist/shared/build-env.json` (in packaged builds) to choose which environment to connect to:

| Value | Web App URL | API URL |
|-------|-------------|---------|
| `development` | https://cloudup.test | https://api.cloudup.test |
| `staging` | https://stage-cloudup.com | https://api.stage-cloudup.com |
| `production` (default) | https://cloudup.com | https://api.cloudup.com |

## Project Structure

```
apps/desktop/
├── src/
│   ├── main/                     # Main process
│   │   ├── index.ts              # Entry point, app lifecycle
│   │   ├── window.ts             # BrowserWindow setup
│   │   ├── tray.ts               # Menu bar icon & context menu
│   │   ├── network.ts            # Online/offline detection
│   │   ├── updater.ts            # Auto-updates
│   │   ├── preferences.ts        # User preferences (electron-store)
│   │   ├── auth/
│   │   │   ├── token-extractor.ts  # JWT extraction from web session
│   │   │   └── token-store.ts      # Encrypted token caching (safeStorage)
│   │   ├── screenshot/
│   │   │   └── detector.ts       # File system watcher (chokidar)
│   │   └── upload/
│   │       └── uploader.ts       # Upload orchestrator (web app → S3)
│   ├── preload/
│   │   └── preload.ts            # Minimal IPC bridge
│   └── shared/
│       └── config.ts             # Per-environment configuration
├── assets/
│   ├── icons/                    # App icon + tray icons (with @2x)
│   └── offline.html              # Offline fallback page
├── build/
│   └── entitlements.mac.plist    # macOS code signing entitlements
├── fastlane/
│   └── Fastfile                  # Code signing & notarization lanes
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── Gemfile                       # Ruby deps for Fastlane
├── .ruby-version
└── .xcode-version
```

CI pipeline configuration lives at `.buildkite/desktop/` in the repository root.

## How It Works

The app loads the Cloudup web app in an Electron BrowserWindow. When you upload a file (via drag-drop or screenshot detection), the native code:

1. Extracts your auth token from the web app's session cookies (via `/refresh-token`, cached with `safeStorage`)
2. Passes the files to the web app's uploader (`window.__cloudup_uploader__`) which creates a stream, items, and presigned S3 URLs
3. Streams the file from disk directly to S3 (constant memory, max 3 concurrent uploads)
4. Reports progress to the web app (`updateItemProgress`) so the stream view shows a progress bar
5. Tells the web app when each upload is done (`markItemComplete`)

Upload logic (stream creation, presigned URLs, progress UI) stays in the web app; the desktop app only handles streaming file data to S3. Files larger than 100 MB are rejected with a notification.

## Web App Dependency

The desktop app requires the web app to expose its uploader globally:

```typescript
// cloudup-php/www.cloudup/src/frontend/dashboard-app/state.ts
(window as any).__cloudup_uploader__ = uploader;
```

This is already included in the codebase. If you're testing against a web app without this change, uploads will fail with "Web app uploader not available".

## Code Signing & Distribution

macOS builds are signed and notarized via Fastlane:

- **Code signing** uses `fastlane match` with Developer ID certificates stored in S3
- **Notarization** submits the `.app` bundle to Apple's notary service
- **CI** runs on Buildkite (`.buildkite/desktop/pipeline.yml`) with a Mac agent queue

Packaged artifacts (DMG + ZIP) are output to `apps/desktop/release/`.

## Troubleshooting

### "Web app uploader not available"
The web app hasn't exposed its uploader. Rebuild the web app:
```bash
make cloudup-js:build
```

### Certificate errors in development
The app automatically trusts self-signed certificates for trusted domains (`*.cloudup.test`, `*.cldup.test`, `*.minio.test`) when running with `CLOUDUP_ENV=development`. External domains use standard CA validation.

### Upload fails silently
Check the terminal output for error messages. Common issues:
- Not logged in (open the app and log in first)
- File exceeds 100 MB size limit
- Network offline
- Web app not running (for local development)

### Window doesn't appear
The app runs as a menu bar app with no dock icon. Look for the Cloudup icon in the macOS menu bar. If another instance is already running, the new one will quit silently.
