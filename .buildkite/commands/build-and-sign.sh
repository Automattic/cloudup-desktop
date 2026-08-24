#!/usr/bin/env bash

set -eu -o pipefail



echo "--- :ruby: Install Ruby tooling"
install_gems

echo "--- :lock_with_ink_pen: Configure code signing"
bundle exec fastlane configure_code_signing

echo "--- :npm: Install Node dependencies"
npm ci

echo "--- :typescript: Build"
# CLOUDUP_ENV controls which backend the packaged app connects to (baked into build-env.json).
# Change to 'production' when ready for production release.
export CLOUDUP_ENV="${CLOUDUP_ENV:-staging}"
echo "CLOUDUP_ENV=${CLOUDUP_ENV}"
npm run build

echo "--- :electron: Package and sign"
export CSC_KEYCHAIN=fastlane_tmp_keychain
# `--publish never` prevents electron-builder from automatically uploading the artifact to
# GitHub Releases. We handle distribution separately (internal testing only for now).
# See https://www.electron.build/publish for available publish options.
npx electron-builder --mac --publish never

echo "--- :apple: Notarize"
bundle exec fastlane notarize_binary
