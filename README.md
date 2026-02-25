# Cloudup Desktop App

A native macOS menu bar app that wraps the Cloudup web app with native OS integrations.

## Features

- **Menu bar icon** - Click to show/hide the Cloudup web app
- **Global hotkey** - `Cmd+Shift+U` to upload files from anywhere
- **Screenshot auto-upload** - Automatically uploads new screenshots from Desktop and Pictures/Screenshots
- **Drag-and-drop** - Drop files directly onto the menu bar icon to upload (multiple files go to same stream)
- **Native notifications** - Upload status notifications
- **Auto-login prompt** - Opens login page automatically on first launch if not logged in
- **Preferences** - Right-click tray for "Open at Login" and "Auto-Stream Screenshots" toggles

For architecture details and implementation notes, see [docs/plans/webview-desktop-app.md](../../docs/plans/webview-desktop-app.md).

## Prerequisites

- Node.js 18 or 20 LTS (Node 25+ has compatibility issues with electron-builder)
- npm
- The Cloudup web app must be running (for development) or accessible (for production)

## Setup

```bash
cd apps/desktop
npm install
```

## Development

### Local Development (cloudup.test)

For development against your local Cloudup instance:

```bash
npm run dev
```

This runs against `https://cloudup.test` with self-signed certificate support enabled.

### Production Mode

To run against production `https://cloudup.com`:

```bash
npm run prod
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Build and run against local cloudup.test |
| `npm run prod` | Build and run against production |
| `npm run stage` | Build and run against staging |
| `npm run build` | Compile TypeScript and write build env (for packaging) |
| `npm run start` | Run without rebuilding |
| `npm run dist` | Package for distribution |
| `npm run dist:mac` | Package for macOS (production config) |
| `npm run dist:mac:stage` | Package for macOS with staging config (stage-cloudup.com) |

Packaged builds bake in the environment: `dist:mac` uses production (cloudup.com); `dist:mac:stage` uses staging (stage-cloudup.com). The packaged app then uses that config even when launched by double-click (no env vars required).

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
│   ├── main/                 # Main process
│   │   ├── index.ts          # Entry point
│   │   ├── window.ts         # BrowserWindow setup
│   │   ├── tray.ts           # Menu bar icon
│   │   ├── network.ts        # Online/offline detection
│   │   ├── updater.ts        # Auto-updates
│   │   ├── preferences.ts    # User preferences
│   │   ├── auth/             # Token extraction & storage
│   │   ├── screenshot/       # Hotkey & auto-detection
│   │   └── upload/           # Upload handling
│   ├── preload/              # Preload scripts
│   └── shared/               # Shared config
├── assets/
│   ├── icons/                # Tray icons
│   └── offline.html          # Offline fallback
├── package.json
├── tsconfig.json
└── electron-builder.yml
```

## How It Works

The app loads the Cloudup web app in an Electron BrowserWindow. When you upload a file (via hotkey, drag-drop, or screenshot detection), the native code:

1. Extracts your auth token from the web app's session (or uses cached token)
2. Asks the web app for an upload plan (`createUploadPlan` → presigned S3 URL and stream/item IDs)
3. Streams the file from disk directly to S3 (constant memory)
4. Reports progress to the web app (`updateItemProgress`) so the stream view shows a progress bar
5. Tells the web app when each upload is done (`markItemComplete`)

Upload logic (stream creation, presigned URLs, progress UI) stays in the web app; the desktop only handles streaming file data to S3.

## Web App Dependency

The desktop app requires a one-line addition to the web app to expose the uploader:

```typescript
// cloudup-php/www.cloudup/src/frontend/dashboard-app/state.ts
(window as any).__cloudup_uploader__ = uploader;
```

This is already included in the codebase. If you're testing against a web app without this change, uploads will fail with "Web app uploader not available".

## Troubleshooting

### "Web app uploader not available"
The web app hasn't exposed its uploader. Rebuild the web app:
```bash
make cloudup-js:build
```

### Certificate errors in development
The app automatically trusts self-signed certificates for `*.cloudup.test` domains when running with `CLOUDUP_ENV=development`.

### Upload fails silently
Check the terminal output for error messages. Common issues:
- Not logged in (open the app and log in first)
- Network offline
- Web app not running (for local development)
