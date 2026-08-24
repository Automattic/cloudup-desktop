# AGENTS.md

## Overview

Cloudup Desktop is an Electron menu-bar app that wraps the Cloudup web app (cloudup.com) in a webview. Native code handles OS integration only (tray, screenshot detection, drag-and-drop, upload streaming to S3); auth and upload orchestration live in the web app. See README.md for architecture.

This repo was extracted from [Automattic/cloudup-mono](https://github.com/Automattic/cloudup-mono) (`apps/desktop`, August 2026). The backend services it talks to still live there.

## Conventions

- Commits: imperative mood, category prefix (`Fix:`, `Add:`, `Refactor:`, `Docs:`, `Housekeeping:`), subject under 72 chars
- Branches: based on `trunk`, prefix/kebab-case (`fix/`, `add/`, `feature/`, `update/`)
- Lint and tests MUST pass before merge: `make lint`, `make test`

## Development

- `make help` lists all targets; npm scripts in `package.json` are the source of truth
- Node version: `.nvmrc` (Node 25+ breaks electron-builder)
- Local development against `cloudup.test` requires the cloudup-mono dev stack running
- When adding or changing tests, run mutation testing (`make mutation-incremental`) — see `.agents/skills/desktop-mutation/SKILL.md` and `docs/desktop-mutation-workflow.md`

## CI and releases

- Buildkite (`.buildkite/`): staging build, signing, notarization on a8c Mac agents. Ordinary CI only — production release lanes are a future, separate structure (`.buildkite/release-pipelines/`).
- GitHub Actions (`.github/workflows/desktop-build.yml`): lint + tests on Linux, unsigned staging build on macOS.
- **No production publishing**: `electron-builder.yml` deliberately has no `publish` target; the distribution backend is undecided. Do not add one, and do not publish artifacts anywhere, without an explicit decision.
- Signing secrets are Buildkite-agent env vars only. Never commit credentials, and never write credential files inside paths that electron-builder packages (`dist/`, `assets/`).

## Legacy client note

A legacy Objective-C Cloudup app (bundle ID `com.cloudup.Cloudup`, updates via `updates.cloudup.com`) still exists; migrating its users to this app (bundle ID `com.automattic.cloudup`) is a separate, documented workstream — see `docs/desktop-app-update-process.md`.
