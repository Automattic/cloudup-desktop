import { NetworkManager } from './network';
import { net } from 'electron';
import { setShowingOfflinePage } from './offline-state';

const mockNet = net as jest.Mocked<typeof net> & {
	request: jest.Mock;
};

function createMockWin() {
	const webContentsListeners: Record<string, Function[]> = {};
	let webRequestHandler: Function | null = null;

	const webContents = {
		on: jest.fn((event: string, fn: Function) => {
			webContentsListeners[event] = [...(webContentsListeners[event] ?? []), fn];
		}),
		once: jest.fn((event: string, fn: Function) => {
			webContentsListeners[`once:${event}`] = [fn];
		}),
		removeListener: jest.fn(),
		session: {
			webRequest: {
				onErrorOccurred: jest.fn((_filter: unknown, fn: Function) => {
					webRequestHandler = fn;
				}),
			},
		},
		executeJavaScript: jest.fn().mockResolvedValue(true),
		getURL: jest.fn(() => 'https://cloudup.test/'),
	};

	const win = {
		webContents,
		loadFile: jest.fn(),
		loadURL: jest.fn(),
		isDestroyed: jest.fn(() => false),
		// helpers for triggering events in tests
		_emitWebContents: (event: string, ...args: unknown[]) => {
			(webContentsListeners[event] ?? []).forEach((fn) => fn(...args));
		},
		_emitWebContentsOnce: (event: string, ...args: unknown[]) => {
			(webContentsListeners[`once:${event}`] ?? []).forEach((fn) => fn(...args));
			delete webContentsListeners[`once:${event}`];
		},
		_getWebRequestHandler: () => webRequestHandler,
	};

	return win;
}

describe('NetworkManager', () => {
	let win: ReturnType<typeof createMockWin>;
	let manager: NetworkManager;

	beforeEach(() => {
		win = createMockWin();
		mockNet.isOnline.mockReturnValue(true);
		setShowingOfflinePage(false);
		jest.useFakeTimers();
	});

	afterEach(() => {
		manager?.stop();
		jest.useRealTimers();
		setShowingOfflinePage(false);
	});

	describe('constructor', () => {
		it('initialises as online when net.isOnline() is true', () => {
			mockNet.isOnline.mockReturnValue(true);
			manager = new NetworkManager(win as any);
			// start() should not immediately load the offline page
			manager.start();
			expect(win.loadFile).not.toHaveBeenCalled();
		});

		it('initialises as offline when net.isOnline() is false', () => {
			mockNet.isOnline.mockReturnValue(false);
			manager = new NetworkManager(win as any);
			manager.start();
			// offline page is not shown on construction — only after a load failure
			expect(win.loadFile).not.toHaveBeenCalled();
		});
	});

	describe('stop()', () => {
		it('prevents the check interval from firing after stop', () => {
			manager = new NetworkManager(win as any);
			manager.start();
			manager.stop();

			mockNet.isOnline.mockReturnValue(false);
			setShowingOfflinePage(true);
			jest.advanceTimersByTime(10_000);

			expect(win.loadURL).not.toHaveBeenCalled();
		});
	});

	describe('did-fail-load handler', () => {
		it('loads the offline page on ERR_INTERNET_DISCONNECTED (-106)', () => {
			manager = new NetworkManager(win as any);
			manager.start();

			win._emitWebContents('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED');

			expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('offline.html'));
		});

		it('loads the offline page on ERR_NAME_NOT_RESOLVED (-105)', () => {
			manager = new NetworkManager(win as any);
			manager.start();

			win._emitWebContents('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED');

			expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('offline.html'));
		});

		it('loads the offline page on ERR_CONNECTION_REFUSED (-102)', () => {
			manager = new NetworkManager(win as any);
			manager.start();

			win._emitWebContents('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED');

			expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('offline.html'));
		});

		it('ignores unrelated load error codes', () => {
			manager = new NetworkManager(win as any);
			manager.start();

			win._emitWebContents('did-fail-load', {}, -200, 'ERR_FAILED');

			expect(win.loadFile).not.toHaveBeenCalled();
		});
	});

	describe('webRequest error handler', () => {
		it('loads the offline page when a connection error occurs for the app origin', () => {
			manager = new NetworkManager(win as any);
			manager.start();

			const handler = win._getWebRequestHandler()!;
			handler({ error: 'net::ERR_CONNECTION_REFUSED', url: 'https://cloudup.test/api/me' });

			expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('offline.html'));
		});

		it('does not load the offline page when already showing it', () => {
			setShowingOfflinePage(true);
			manager = new NetworkManager(win as any);
			manager.start();

			const handler = win._getWebRequestHandler()!;
			handler({ error: 'net::ERR_CONNECTION_REFUSED', url: 'https://cloudup.test/api/me' });

			expect(win.loadFile).not.toHaveBeenCalled();
		});

		it('ignores non-connection errors', () => {
			manager = new NetworkManager(win as any);
			manager.start();

			const handler = win._getWebRequestHandler()!;
			handler({ error: 'net::ERR_BLOCKED_BY_RESPONSE', url: 'https://cloudup.test/api/me' });

			expect(win.loadFile).not.toHaveBeenCalled();
		});

		it('ignores errors when the current page is not the app URL', () => {
			manager = new NetworkManager(win as any);
			manager.start();
			win.webContents.getURL.mockReturnValue('file:///offline.html');

			const handler = win._getWebRequestHandler()!;
			handler({ error: 'net::ERR_CONNECTION_REFUSED', url: 'https://cloudup.test/api/me' });

			expect(win.loadFile).not.toHaveBeenCalled();
		});

		it('handles each known connection error code', () => {
			const codes = [
				'ERR_CONNECTION_REFUSED',
				'ERR_CONNECTION_RESET',
				'ERR_NAME_NOT_RESOLVED',
				'ERR_INTERNET_DISCONNECTED',
				'ERR_CONNECTION_TIMED_OUT',
				'ERR_NETWORK_CHANGED',
			];

			for (const code of codes) {
				win = createMockWin();
				setShowingOfflinePage(false);
				manager = new NetworkManager(win as any);
				manager.start();

				const handler = win._getWebRequestHandler()!;
				handler({ error: `net::${code}`, url: 'https://cloudup.test/api/me' });

				expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('offline.html'));
				manager.stop();
			}
		});
	});

	describe('interval: network state transitions', () => {
		it('reloads the web app when coming back online while on the offline page', () => {
			mockNet.isOnline.mockReturnValue(false);
			manager = new NetworkManager(win as any);
			setShowingOfflinePage(true);
			manager.start();

			mockNet.isOnline.mockReturnValue(true);
			jest.advanceTimersByTime(3_000);

			expect(win.loadURL).toHaveBeenCalled();
		});

		it('does not reload when coming back online without the offline page showing', () => {
			mockNet.isOnline.mockReturnValue(false);
			manager = new NetworkManager(win as any);
			setShowingOfflinePage(false);
			manager.start();

			mockNet.isOnline.mockReturnValue(true);
			jest.advanceTimersByTime(3_000);

			expect(win.loadURL).not.toHaveBeenCalled();
		});

		it('does not trigger a reload while already online and not showing the offline page', () => {
			mockNet.isOnline.mockReturnValue(true);
			manager = new NetworkManager(win as any);
			setShowingOfflinePage(false);
			manager.start();

			jest.advanceTimersByTime(3_000);

			expect(win.loadURL).not.toHaveBeenCalled();
			expect(win.loadFile).not.toHaveBeenCalled();
		});
	});

	describe('onReconnected / onShowOfflinePage callbacks', () => {
		it('calls onShowOfflinePage when the offline page is loaded', () => {
			const onShowOfflinePage = jest.fn();
			manager = new NetworkManager(win as any);
			manager.start({ onShowOfflinePage });

			win._emitWebContents('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED');

			expect(onShowOfflinePage).toHaveBeenCalled();
		});
	});
});
