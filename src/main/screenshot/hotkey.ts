import { globalShortcut, dialog } from 'electron';
import log from 'electron-log';

export class HotkeyManager {
  private shortcut: string;
  private callback: ((filePaths: string[]) => void) | null = null;

  constructor() {
    // Cmd+Shift+U on macOS, Ctrl+Shift+U on Windows/Linux
    this.shortcut =
      process.platform === 'darwin' ? 'CommandOrControl+Shift+U' : 'Control+Shift+U';
  }

  register(onFileSelected: (filePaths: string[]) => void): boolean {
    this.callback = onFileSelected;

    const registered = globalShortcut.register(this.shortcut, async () => {
      await this.showFileDialog();
    });

    if (!registered) {
      log.error('Failed to register hotkey', { shortcut: this.shortcut });
    }

    return registered;
  }

  private async showFileDialog(): Promise<void> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      this.callback?.(result.filePaths);
    }
  }

  unregister(): void {
    globalShortcut.unregister(this.shortcut);
    this.callback = null;
  }
}
