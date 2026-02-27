import { Tray, Menu, app, nativeImage, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { toggleWindow } from './window';
import {
  getOpenAtLogin,
  setOpenAtLogin,
  getAutoStreamScreenshots,
  setAutoStreamScreenshots,
} from './preferences';
import { getOpenFileDialogOptions } from '../shared/file-dialog';

export type TrayState = 'idle' | 'uploading' | 'error';

export class TrayManager {
  private tray: Tray | null = null;
  private win: BrowserWindow;
  private state: TrayState = 'idle';
  private onQuit: () => void;
  private fileDropCallback: ((filePaths: string[]) => void) | null = null;
  private onAutoStreamToggle: ((enabled: boolean) => void) | null = null;

  constructor(win: BrowserWindow, onQuit: () => void) {
    this.win = win;
    this.onQuit = onQuit;
  }

  create(): Tray {
    const icon = this.getIcon('idle');

    this.tray = new Tray(icon);
    this.tray.setToolTip('Cloudup');

    // Click toggles window
    this.tray.on('click', () => {
      if (this.tray) {
        toggleWindow(this.win, this.tray);
      }
    });

    // Right-click shows context menu
    this.tray.on('right-click', () => {
      this.showContextMenu();
    });

    // Support drag-and-drop to tray
    this.tray.on('drop-files', (_event, files) => {
      log.info('Files dropped on tray', { count: files.length });
      if (this.fileDropCallback && files.length > 0) {
        this.fileDropCallback(files);
      }
    });

    log.info('Tray created');
    return this.tray;
  }

  onFileDrop(callback: (filePaths: string[]) => void): void {
    this.fileDropCallback = callback;
  }

  onAutoStreamScreenshotsToggle(callback: (enabled: boolean) => void): void {
    this.onAutoStreamToggle = callback;
  }

  private async showFileDialog(): Promise<void> {
    const result = await dialog.showOpenDialog(getOpenFileDialogOptions());

    if (!result.canceled && result.filePaths.length > 0 && this.fileDropCallback) {
      this.fileDropCallback(result.filePaths);
    }
  }

  private showContextMenu(): void {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Cloudup',
        click: () => {
          if (this.tray) {
            toggleWindow(this.win, this.tray);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Upload File...',
        accelerator: process.platform === 'darwin' ? 'Cmd+Shift+U' : 'Ctrl+Shift+U',
        click: () => {
          this.showFileDialog();
        },
      },
      { type: 'separator' },
      {
        label: 'Open at Login',
        type: 'checkbox',
        checked: getOpenAtLogin(),
        click: (menuItem) => {
          setOpenAtLogin(menuItem.checked);
        },
      },
      {
        label: 'Auto-Stream Screenshots',
        type: 'checkbox',
        checked: getAutoStreamScreenshots() === true, // Show checked only if explicitly true
        click: (menuItem) => {
          setAutoStreamScreenshots(menuItem.checked);
          this.onAutoStreamToggle?.(menuItem.checked);
        },
      },
      { type: 'separator' },
      {
        label: 'About Cloudup',
        click: () => {
          app.showAboutPanel();
        },
      },
      {
        label: 'Quit',
        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : undefined,
        click: () => {
          this.onQuit();
        },
      },
    ]);

    this.tray?.popUpContextMenu(menu);
  }

  setState(state: TrayState): void {
    if (this.state === state) return;
    this.state = state;

    const icon = this.getIcon(state);
    this.tray?.setImage(icon);
  }

  private getIcon(state: TrayState): Electron.NativeImage {
    const iconPath = this.getIconPath(state);

    let icon: Electron.NativeImage;

    // Check if icon file exists, otherwise create a fallback
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      // Create a simple fallback icon (16x16 cloud shape)
      log.warn('Tray icon not found, using fallback', { path: iconPath });
      icon = this.createFallbackIcon(state);
    }

    // Make it a template image on macOS for proper menu bar appearance
    // Only use template mode for idle state - uploading/error use colored icons
    if (process.platform === 'darwin') {
      icon.setTemplateImage(state === 'idle');
    }

    return icon;
  }

  private createFallbackIcon(_state: TrayState): Electron.NativeImage {
    // Create a 16x16 PNG icon programmatically
    // This is a simple cloud shape as raw PNG data
    // PNG header + IHDR + IDAT (compressed) + IEND

    // Alternative: create a simple filled rectangle as absolute fallback
    // This ensures something shows up in the menu bar
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4); // RGBA

    // Draw a simple cloud-like shape (filled circle/ellipse area)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Simple cloud shape: main body + bump on top
        const inMainBody = (
          // Main ellipse body (bottom 2/3)
          Math.pow((x - 8) / 6, 2) + Math.pow((y - 10) / 4, 2) <= 1
        );
        const inTopBump = (
          // Top bump (smaller circle)
          Math.pow((x - 6) / 3, 2) + Math.pow((y - 6) / 3, 2) <= 1
        );
        const inRightBump = (
          // Right bump
          Math.pow((x - 11) / 2.5, 2) + Math.pow((y - 7) / 2.5, 2) <= 1
        );

        if (inMainBody || inTopBump || inRightBump) {
          buffer[idx] = 0;     // R - black for template
          buffer[idx + 1] = 0; // G
          buffer[idx + 2] = 0; // B
          buffer[idx + 3] = 255; // A - fully opaque
        } else {
          buffer[idx] = 0;
          buffer[idx + 1] = 0;
          buffer[idx + 2] = 0;
          buffer[idx + 3] = 0; // Transparent
        }
      }
    }

    return nativeImage.createFromBuffer(buffer, {
      width: size,
      height: size,
    });
  }

  private getIconPath(state: TrayState): string {
    const iconName = state === 'idle' ? 'trayIconTemplate.png' : `trayIcon-${state}Template.png`;
    return path.join(__dirname, '..', '..', 'assets', 'icons', iconName);
  }

  getTray(): Tray | null {
    return this.tray;
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
