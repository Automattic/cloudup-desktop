import { contextBridge } from 'electron';

/**
 * Minimal preload script - only exposes desktop app detection.
 * Auth and uploads are handled by the webview (web app) itself.
 */
contextBridge.exposeInMainWorld('cloudupDesktop', {
  isDesktopApp: true,
  platform: process.platform,
});
