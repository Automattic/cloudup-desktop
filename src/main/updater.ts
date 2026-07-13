import { autoUpdater } from 'electron-updater';
import { Notification } from 'electron';
import log from 'electron-log';
import { ENV } from '../shared/config';

let updateCheckInterval: ReturnType<typeof setInterval> | null = null;

export function initAutoUpdater(): void {
	// Only run auto-updater in production
	if (ENV !== 'production') {
		log.info('Auto-updater disabled in non-production environment');
		return;
	}

	autoUpdater.logger = log;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	// Check for updates on startup
	autoUpdater.checkForUpdates().catch((err) => {
		log.error('Failed to check for updates', { error: err.message });
	});

	// Check for updates every 4 hours
	updateCheckInterval = setInterval(() => {
		autoUpdater.checkForUpdates().catch((err) => {
			log.error('Failed to check for updates', { error: err.message });
		});
	}, 4 * 60 * 60 * 1000);

	autoUpdater.on('checking-for-update', () => {
		log.info('Checking for update...');
	});

	autoUpdater.on('update-available', (info) => {
		log.info('Update available', { version: info.version });
	});

	autoUpdater.on('update-not-available', () => {
		log.info('No update available');
	});

	autoUpdater.on('download-progress', (progress) => {
		log.info('Download progress', { percent: Math.round(progress.percent) });
	});

	autoUpdater.on('update-downloaded', (info) => {
		log.info('Update downloaded', { version: info.version });

		new Notification({
			title: 'Cloudup Update Ready',
			body: `Version ${info.version} is ready. Restart to install.`,
		}).show();
	});

	autoUpdater.on('error', (err) => {
		log.error('Auto-updater error', { error: err.message });
	});
}

/**
 * Clear the periodic update-check interval started by {@link initAutoUpdater}.
 * Safe to call even if the updater was never started (non-production env).
 */
export function stopAutoUpdater(): void {
	if (updateCheckInterval) {
		clearInterval(updateCheckInterval);
		updateCheckInterval = null;
	}
}
