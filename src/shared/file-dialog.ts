import type { OpenDialogOptions } from 'electron';

/**
 * Shared options for "open file(s)" dialogs (tray upload).
 * Returns a new object each call so Electron receives a mutable options object.
 */
export function getOpenFileDialogOptions(): OpenDialogOptions {
	return {
		properties: ['openFile', 'multiSelections'],
		filters: [
			{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
			{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
			{ name: 'All Files', extensions: ['*'] },
		],
	};
}
