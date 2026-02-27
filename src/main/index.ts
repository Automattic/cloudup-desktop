import { app, globalShortcut, BrowserWindow, dialog } from 'electron';
import log from 'electron-log';
import { createWindow, toggleWindow, setIsQuittingCheck, setupInitialAuthCheck } from './window';
import * as path from 'path';
import { TrayManager } from './tray';
import { NetworkManager } from './network';
import { TokenExtractor } from './auth/token-extractor';
import { TokenStore } from './auth/token-store';
import { Uploader } from './upload/uploader';
import { ScreenshotDetector } from './screenshot/detector';
import { HotkeyManager } from './screenshot/hotkey';
import { initAutoUpdater } from './updater';
import { initPreferences, getAutoStreamScreenshots, setAutoStreamScreenshots } from './preferences';
import { CONFIG, ENV, isTrustedDomain } from '../shared/config';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = ENV === 'production' ? 'warn' : 'debug';

// Track if app is quitting (for window close handling)
let isQuitting = false;

// Export for use in window.ts
export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(value: boolean): void {
  isQuitting = value;
}

// Handle certificate errors for development environment (same trusted-domains logic as window.ts)
if (CONFIG.allowInsecure && CONFIG.trustedDomains.length > 0) {
  app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      callback(false);
      return;
    }
    const isTrusted = isTrustedDomain(hostname);
    if (isTrusted) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info('Another instance is running, quitting');
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let trayManager: TrayManager | null = null;
  let networkManager: NetworkManager | null = null;
  let tokenExtractor: TokenExtractor | null = null;
  let uploader: Uploader | null = null;
  let screenshotDetector: ScreenshotDetector | null = null;
  let hotkeyManager: HotkeyManager | null = null;

  // Handle second instance - show window
  app.on('second-instance', () => {
    if (mainWindow) {
      if (trayManager?.getTray()) {
        toggleWindow(mainWindow, trayManager.getTray()!);
      }
    }
  });

  app.whenReady().then(() => {
    log.info('App starting', {
      version: app.getVersion(),
      env: ENV,
      platform: process.platform,
    });

    // Set up About panel branding
    app.setAboutPanelOptions({
      applicationName: 'Cloudup',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2026 Automattic',
      version: '', // Hide build number
    });

    // Hide dock icon on macOS (menu bar app)
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }

    // Initialize user preferences (including login item sync)
    initPreferences();

    // Set up the isQuitting check for window close handling
    setIsQuittingCheck(getIsQuitting);

    // Create main window
    mainWindow = createWindow();

    // Create tray with upload handler
    trayManager = new TrayManager(mainWindow, () => {
      setIsQuitting(true);
      app.quit();
    });
    trayManager.create();

    // Check auth on initial load and show login if needed
    if (trayManager.getTray()) {
      setupInitialAuthCheck(mainWindow, trayManager.getTray()!);
    }

    // Initialize network monitoring
    networkManager = new NetworkManager(mainWindow);
    networkManager.start({
      onReconnected: () => trayManager?.setState('idle'),
      onShowOfflinePage: () => trayManager?.setState('error'),
    });

    // Initialize token extraction
    tokenExtractor = new TokenExtractor(mainWindow);

    // Watch for auth changes and cache token
    tokenExtractor.onAuthChange((token) => {
      if (token) {
        TokenStore.save(token);
        log.info('Token cached from webview');
      } else {
        TokenStore.clear();
        log.info('Token cleared (user logged out)');
      }
    });

    // Initialize uploader with the window (for certificate handling via webview)
    uploader = new Uploader(
      tokenExtractor,
      mainWindow,
      () => {
        // Show window (but don't toggle - we always want to show on upload)
        if (mainWindow && trayManager?.getTray() && !mainWindow.isVisible()) {
          toggleWindow(mainWindow, trayManager.getTray()!);
        }
      },
      {
        onUploadStarted: () => trayManager?.setState('uploading'),
        onUploadComplete: () => trayManager?.setState('idle'),
        onUploadError: () => trayManager?.setState('error'),
      }
    );

    // Handle single file upload (for hotkey and screenshot detection)
    const handleUpload = (filePath: string) => {
      uploader?.upload(filePath);
    };

    // Track if permission dialog is currently showing to avoid race conditions
    let permissionDialogOpen = false;
    const queuedScreenshots: string[] = [];

    // Handle screenshot detection with permission prompt
    const handleScreenshot = async (filePath: string) => {
      const autoStream = getAutoStreamScreenshots();
      
      if (autoStream === null) {
        // If dialog is already open, queue this screenshot
        if (permissionDialogOpen) {
          queuedScreenshots.push(filePath);
          return;
        }

        // First time - ask for permission
        permissionDialogOpen = true;
        try {
          const result = await dialog.showMessageBox(mainWindow!, {
            type: 'question',
            buttons: ['Yes, always upload', 'No, don\'t auto-upload'],
            defaultId: 0,
            cancelId: 1,
            title: 'Auto-upload Screenshots?',
            message: 'Would you like to automatically upload screenshots to Cloudup?',
            detail: `This screenshot will be uploaded: ${path.basename(filePath)}\n\nYou can change this setting anytime in the menu.`,
          });
          
          const enabled = result.response === 0;
          setAutoStreamScreenshots(enabled);
          
          if (enabled) {
            // Batch all screenshots (current + queued) into a single upload
            const allPaths = [filePath, ...queuedScreenshots];
            uploader?.uploadMultiple(allPaths);
          }
          // Clear queue regardless of user's choice
          queuedScreenshots.length = 0;
        } finally {
          permissionDialogOpen = false;
        }
      } else if (autoStream === true) {
        // User has enabled auto-upload
        handleUpload(filePath);
      }
      // If false, do nothing (detection still runs, but no upload)
    };

    // Handle multiple file upload (for tray drops and file dialog)
    const MULTI_FILE_CONFIRM_THRESHOLD = 5;
    const handleUploadMultiple = async (filePaths: string[]) => {
      if (filePaths.length > MULTI_FILE_CONFIRM_THRESHOLD) {
        const result = await dialog.showMessageBox(mainWindow!, {
          type: 'question',
          buttons: ['Cancel', 'Upload'],
          defaultId: 1,
          cancelId: 0,
          title: 'Upload many files?',
          message: `Upload ${filePaths.length} files to Cloudup?`,
        });
        if (result.response !== 1) return;
      }
      uploader?.uploadMultiple(filePaths);
    };

    // Initialize screenshot detector (always start - detection is on by default)
    // The preference only controls whether to auto-upload
    screenshotDetector = new ScreenshotDetector();
    screenshotDetector.start(handleScreenshot).catch((err) => {
      log.error('Failed to start screenshot detector', { error: (err as Error).message });
    });

    // Initialize global hotkey
    hotkeyManager = new HotkeyManager();
    hotkeyManager.register(handleUploadMultiple);

    // Set up tray file drop handler (batch upload)
    trayManager.onFileDrop(handleUploadMultiple);

    // Set up auto-stream screenshots toggle handler
    // Note: Detector always runs, this just controls the preference
    trayManager.onAutoStreamScreenshotsToggle((enabled) => {
      // Preference is already set by the menu click handler
      // Detector continues running regardless
      log.debug('Auto-stream screenshots preference toggled', { enabled });
    });

    // Initialize auto-updater
    initAutoUpdater();

    log.info('App initialized successfully');
  });

  app.on('window-all-closed', () => {
    // Don't quit on macOS when all windows are closed (menu bar app behavior)
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    log.info('App quitting');

    // Cleanup
    networkManager?.stop();
    hotkeyManager?.unregister();
    screenshotDetector?.stop();
    trayManager?.destroy();
    globalShortcut.unregisterAll();
  });

  app.on('activate', () => {
    // On macOS re-create window when dock icon is clicked
    if (mainWindow && trayManager?.getTray()) {
      toggleWindow(mainWindow, trayManager.getTray()!);
    }
  });
}
