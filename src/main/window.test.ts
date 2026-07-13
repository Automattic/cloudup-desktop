import log from 'electron-log';
import { positionWindowBelowTray, toggleWindow, setupInitialAuthCheck, shouldHideInsteadOfClose } from './window';
import { isAppReadyForAuth, setShowingOfflinePage } from './offline-state';

jest.mock('./offline-state', () => ({
	isAppReadyForAuth: jest.fn(() => true),
	setShowingOfflinePage: jest.fn(),
}));

function makeMockWin(visible = false) {
	return {
		isVisible: jest.fn(() => visible),
		hide: jest.fn(),
		show: jest.fn(),
		focus: jest.fn(),
		getBounds: jest.fn(() => ({ x: 0, y: 0, width: 420, height: 650 })),
		setPosition: jest.fn(),
		webContents: {
			getURL: jest.fn(() => 'https://local-cloudup.com/'),
		},
	};
}

function makeMockTray(bounds = { x: 100, y: 20, width: 22, height: 22 }) {
	return {
		getBounds: jest.fn(() => bounds),
	};
}

describe('positionWindowBelowTray', () => {
	it('centers the window horizontally under the tray icon', () => {
		const win = makeMockWin();
		const tray = makeMockTray({ x: 100, y: 20, width: 22, height: 22 });

		positionWindowBelowTray(win as any, tray as any);

		// x = round(100 + 22/2 - 420/2) = round(100 + 11 - 210) = -99
		// y = round(20 + 22 + 4) = 46
		expect(win.setPosition).toHaveBeenCalledWith(-99, 46, false);
	});

	it('places window 4px below the bottom edge of the tray icon', () => {
		const win = makeMockWin();
		win.getBounds.mockReturnValue({ x: 0, y: 0, width: 200, height: 500 });
		const tray = makeMockTray({ x: 0, y: 0, width: 20, height: 20 });

		positionWindowBelowTray(win as any, tray as any);

		// y = round(0 + 20 + 4) = 24
		expect(win.setPosition).toHaveBeenCalledWith(expect.any(Number), 24, false);
	});

	it('rounds fractional coordinates to integers', () => {
		const win = makeMockWin();
		win.getBounds.mockReturnValue({ x: 0, y: 0, width: 420, height: 650 });
		// odd tray width to produce fractional midpoint
		const tray = makeMockTray({ x: 1, y: 0, width: 19, height: 20 });

		positionWindowBelowTray(win as any, tray as any);

		const [x, y] = (win.setPosition as jest.Mock).mock.calls[0];
		expect(Number.isInteger(x)).toBe(true);
		expect(Number.isInteger(y)).toBe(true);
	});

	it('uses tray and window bounds without side effects on win state', () => {
		const win = makeMockWin();
		const tray = makeMockTray();

		positionWindowBelowTray(win as any, tray as any);

		expect(tray.getBounds).toHaveBeenCalled();
		expect(win.getBounds).toHaveBeenCalled();
		expect(win.show).not.toHaveBeenCalled();
		expect(win.hide).not.toHaveBeenCalled();
	});
});

describe('toggleWindow', () => {
	it('hides the window when it is visible', () => {
		const win = makeMockWin(true);
		const tray = makeMockTray();

		toggleWindow(win as any, tray as any);

		expect(win.hide).toHaveBeenCalled();
		expect(win.show).not.toHaveBeenCalled();
		expect(win.focus).not.toHaveBeenCalled();
	});

	it('shows and focuses the window when it is hidden', () => {
		const win = makeMockWin(false);
		const tray = makeMockTray();

		toggleWindow(win as any, tray as any);

		expect(win.show).toHaveBeenCalled();
		expect(win.focus).toHaveBeenCalled();
		expect(win.hide).not.toHaveBeenCalled();
	});

	it('positions the window before showing it', () => {
		const win = makeMockWin(false);
		const tray = makeMockTray({ x: 200, y: 30, width: 22, height: 22 });

		toggleWindow(win as any, tray as any);

		const setPositionOrder = (win.setPosition as jest.Mock).mock.invocationCallOrder[0];
		const showOrder = (win.show as jest.Mock).mock.invocationCallOrder[0];
		expect(setPositionOrder).toBeLessThan(showOrder);
	});
});

describe('shouldHideInsteadOfClose', () => {
	it('vetoes the close (hides) when the app is not quitting', () => {
		// Ordinary window close (click outside, red button, etc.) — menu-bar
		// app should hide, not quit.
		expect(shouldHideInsteadOfClose(false)).toBe(true);
	});

	it('allows the close through when the app is quitting', () => {
		// Real quit path (OS shutdown/logout, Cmd+Q, tray Quit) — must not be
		// vetoed, or macOS reports the app "couldn't quit" (#1734).
		expect(shouldHideInsteadOfClose(true)).toBe(false);
	});
});

function makeAuthMockWin() {
	const handlers: Record<string, (...args: any[]) => any> = {};
	return {
		isDestroyed: jest.fn(() => false),
		show: jest.fn(),
		focus: jest.fn(),
		getBounds: jest.fn(() => ({ x: 0, y: 0, width: 420, height: 650 })),
		setPosition: jest.fn(),
		loadURL: jest.fn(),
		webContents: {
			getURL: jest.fn(() => 'https://cloudup.test/'),
			on: jest.fn((event: string, cb: (...args: any[]) => any) => {
				handlers[event] = cb;
			}),
		},
		// Invoke the captured did-finish-load handler and return its promise.
		fireDidFinishLoad: () => handlers['did-finish-load']?.(),
	};
}

describe('setupInitialAuthCheck', () => {
	beforeEach(() => {
		jest.mocked(isAppReadyForAuth).mockReturnValue(true);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('does not show the login page when a token is found on the first poll', async () => {
		jest.useFakeTimers();
		const win = makeAuthMockWin();
		const tray = makeMockTray();
		const getToken = jest.fn().mockResolvedValue('token-123');

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const done = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(500);
		await done;

		expect(getToken).toHaveBeenCalledTimes(1);
		expect(win.loadURL).not.toHaveBeenCalled();
		expect(win.show).not.toHaveBeenCalled();
	});

	it('keeps polling and succeeds when the token appears on a later attempt', async () => {
		jest.useFakeTimers();
		const win = makeAuthMockWin();
		const tray = makeMockTray();
		const getToken = jest
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValue('token-123');

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const done = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(1500); // three polls at 500ms
		await done;

		expect(getToken).toHaveBeenCalledTimes(3);
		expect(win.loadURL).not.toHaveBeenCalled();
	});

	it('shows the login page only after every poll returns null', async () => {
		jest.useFakeTimers();
		const win = makeAuthMockWin();
		const tray = makeMockTray();
		const getToken = jest.fn().mockResolvedValue(null);

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const done = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(3000); // six polls at 500ms
		await done;

		expect(getToken).toHaveBeenCalledTimes(6);
		expect(setShowingOfflinePage).toHaveBeenCalledWith(false);
		expect(win.loadURL).toHaveBeenCalledWith(expect.stringContaining('/login'));
		expect(win.show).toHaveBeenCalled();
		expect(win.focus).toHaveBeenCalled();
	});

	it('keeps polling through a transient getToken error before falling back to login', async () => {
		jest.useFakeTimers();
		const win = makeAuthMockWin();
		const tray = makeMockTray();
		const getToken = jest
			.fn()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValue('token-123');

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const done = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(1000); // error on first poll, token on second
		await done;

		expect(getToken).toHaveBeenCalledTimes(2);
		expect(log.warn).toHaveBeenCalledTimes(1); // the transient error is logged, not swallowed silently
		expect(win.loadURL).not.toHaveBeenCalled();
	});

	it('stops polling and does not show login when the window is destroyed mid-check', async () => {
		jest.useFakeTimers();
		const win = makeAuthMockWin();
		win.isDestroyed = jest.fn(() => true);
		const tray = makeMockTray();
		const getToken = jest.fn().mockResolvedValue(null);

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const done = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(3000);
		await done;

		expect(getToken).not.toHaveBeenCalled();
		expect(win.loadURL).not.toHaveBeenCalled();
	});

	it('runs the auth check only once across multiple loads', async () => {
		jest.useFakeTimers();
		const win = makeAuthMockWin();
		const tray = makeMockTray();
		const getToken = jest.fn().mockResolvedValue('token-123');

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const first = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(500);
		await first;

		await win.fireDidFinishLoad(); // hasCheckedAuth guard short-circuits

		expect(getToken).toHaveBeenCalledTimes(1);
	});

	it('skips the auth check when the window is not on the app URL', async () => {
		jest.useFakeTimers();
		jest.mocked(isAppReadyForAuth).mockReturnValue(false);
		const win = makeAuthMockWin();
		const tray = makeMockTray();
		const getToken = jest.fn().mockResolvedValue(null);

		setupInitialAuthCheck(win as any, tray as any, getToken);
		const done = win.fireDidFinishLoad();
		await jest.advanceTimersByTimeAsync(3000);
		await done;

		expect(getToken).not.toHaveBeenCalled();
		expect(win.loadURL).not.toHaveBeenCalled();
	});
});
