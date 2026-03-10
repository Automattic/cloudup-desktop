import { BrowserWindow, session, Tray } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { CONFIG, ENV, isTrustedDomain } from '../shared/config';
import { isAppReadyForAuth, setShowingOfflinePage } from './offline-state';

// Function to check if app is quitting (set from index.ts)
let isQuittingFn: () => boolean = () => false;

export function setIsQuittingCheck(fn: () => boolean): void {
	isQuittingFn = fn;
}

export function createWindow(): BrowserWindow {
	// Get or create the session for this environment
	const ses = session.fromPartition(`persist:cloudup-${ENV}`);

	// In development, trust self-signed certificates for configured domains only
	// For external domains, use default certificate verification
	if (CONFIG.allowInsecure && CONFIG.trustedDomains.length > 0) {
		ses.setCertificateVerifyProc((request, callback) => {
			const hostname = request.hostname;
			const isTrusted = isTrustedDomain(hostname);

			if (isTrusted) {
				// Trust self-signed certificates for local development domains
				callback(0); // 0 = OK
			} else {
				// Use default certificate verification for external domains
				callback(-3); // -3 = Use Chromium's default verification
			}
		});
		log.info('Certificate verification configured for trusted domains', {
			domains: CONFIG.trustedDomains,
		});
	}

	const win = new BrowserWindow({
		width: 420,
		height: 650,
		show: false,
		frame: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		resizable: false,
		vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
		backgroundColor: '#00000000', // Transparent for vibrancy
		webPreferences: {
			preload: path.join(__dirname, '..', 'preload', 'preload.js'),
			session: ses,
			// Security: explicit is better
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			// webSecurity is enabled by default - certificate verification above handles self-signed certs
			webSecurity: true,
		},
	});

	// Make window visible on all macOS spaces to prevent space switching when clicking tray
	if (process.platform === 'darwin') {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	// Load the web app
	win.loadURL(CONFIG.webAppUrl);

	// Hide window when it loses focus (click outside), but delay so that
	// opening a dialog (e.g. file picker) doesn't hide immediately; if focus
	// returns within the delay, we cancel the hide.
	const BLUR_HIDE_DELAY_MS = 250;
	let blurHideTimeout: ReturnType<typeof setTimeout> | null = null;

	win.on('blur', () => {
		if (blurHideTimeout) clearTimeout(blurHideTimeout);
		blurHideTimeout = setTimeout(() => {
			blurHideTimeout = null;
			win.hide();
		}, BLUR_HIDE_DELAY_MS);
	});

	win.on('focus', () => {
		if (blurHideTimeout) {
			clearTimeout(blurHideTimeout);
			blurHideTimeout = null;
		}
	});

	// Keyboard shortcuts for frameless window
	win.webContents.on('before-input-event', (_event, input) => {
		// Escape to hide
		if (input.key === 'Escape') {
			win.hide();
		}
		// Cmd/Ctrl+R to refresh
		if (input.key === 'r' && (input.meta || input.control)) {
			win.webContents.reload();
		}
	});

	// Prevent window from being destroyed, just hide it
	win.on('close', (event) => {
		if (!isQuittingFn()) {
			event.preventDefault();
			win.hide();
		}
	});

	log.info('Main window created', { env: ENV, url: CONFIG.webAppUrl });

	return win;
}

/**
 * Position window directly below tray icon (macOS style)
 */
export function positionWindowBelowTray(win: BrowserWindow, tray: Tray): void {
	const trayBounds = tray.getBounds();
	const winBounds = win.getBounds();

	// Center horizontally below tray icon
	const x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
	// Position below tray with small gap
	const y = Math.round(trayBounds.y + trayBounds.height + 4);

	win.setPosition(x, y, false);
}

/**
 * Toggle window visibility
 */
export function toggleWindow(win: BrowserWindow, tray: Tray): void {
	if (win.isVisible()) {
		win.hide();
	} else {
		positionWindowBelowTray(win, tray);
		win.show();
		win.focus();
	}
}

/**
 * Check authentication on initial load and show login page if not logged in
 */
export function setupInitialAuthCheck(win: BrowserWindow, tray: Tray): void {
	let hasCheckedAuth = false;

	win.webContents.on('did-finish-load', async () => {
		if (hasCheckedAuth) return; // Only check once on initial load
		if (!isAppReadyForAuth(win.webContents.getURL())) return;
		hasCheckedAuth = true;

		try {
			// Check if user is authenticated by trying to get a token
			const token = await win.webContents.executeJavaScript(`
        fetch('/refresh-token', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        })
        .then(r => r.json())
        .then(data => data.access_token || null)
        .catch(() => null)
      `);

			if (!token) {
				log.info('User not logged in, showing login page');
				setShowingOfflinePage(false);
				win.loadURL(`${CONFIG.webAppUrl}/login`);
				// Show window so user can log in
				positionWindowBelowTray(win, tray);
				win.show();
				win.focus();
			}
		} catch (err) {
			log.warn('Failed to check auth status on load', { error: (err as Error).message });
		}
	});
}
