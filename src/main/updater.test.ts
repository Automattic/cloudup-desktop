jest.mock('../shared/config', () => ({ ENV: 'production' }));

jest.mock('electron-updater', () => ({
	autoUpdater: {
		logger: undefined,
		autoDownload: false,
		autoInstallOnAppQuit: false,
		checkForUpdates: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
	},
}));

import { initAutoUpdater, stopAutoUpdater } from './updater';

describe('stopAutoUpdater', () => {
	let clearIntervalSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.useFakeTimers();
		clearIntervalSpy = jest.spyOn(global, 'clearInterval');
	});

	afterEach(() => {
		// Leave interval state clean for the next test regardless of outcome.
		stopAutoUpdater();
		jest.useRealTimers();
		clearIntervalSpy.mockRestore();
	});

	it('clears the periodic update-check interval started by initAutoUpdater', () => {
		initAutoUpdater();
		expect(jest.getTimerCount()).toBeGreaterThan(0);

		stopAutoUpdater();

		expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
		expect(jest.getTimerCount()).toBe(0);
	});

	it('does not call clearInterval when there is no active interval (never started)', () => {
		stopAutoUpdater();

		expect(clearIntervalSpy).not.toHaveBeenCalled();
	});

	it('is a no-op the second time it is called (already stopped)', () => {
		initAutoUpdater();
		stopAutoUpdater();
		clearIntervalSpy.mockClear();

		stopAutoUpdater();

		expect(clearIntervalSpy).not.toHaveBeenCalled();
	});
});
