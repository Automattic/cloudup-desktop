import {
	setShowingOfflinePage,
	isShowingOfflinePage,
	isAppReadyForAuth,
} from './offline-state';

afterEach(() => {
	setShowingOfflinePage(false);
});

describe('offline-state', () => {
	it('defaults to not showing offline page', () => {
		expect(isShowingOfflinePage()).toBe(false);
	});

	it('can toggle offline state', () => {
		setShowingOfflinePage(true);
		expect(isShowingOfflinePage()).toBe(true);

		setShowingOfflinePage(false);
		expect(isShowingOfflinePage()).toBe(false);
	});
});

describe('isAppReadyForAuth', () => {
	it('returns true for app URL when not offline', () => {
		expect(isAppReadyForAuth('https://cloudup.test')).toBe(true);
		expect(isAppReadyForAuth('https://cloudup.test/login')).toBe(true);
	});

	it('returns false for app URL when showing offline page', () => {
		setShowingOfflinePage(true);
		expect(isAppReadyForAuth('https://cloudup.test')).toBe(false);
	});

	it('returns false for non-app URL regardless of offline state', () => {
		expect(isAppReadyForAuth('https://example.com')).toBe(false);
		expect(isAppReadyForAuth('file:///offline.html')).toBe(false);

		setShowingOfflinePage(true);
		expect(isAppReadyForAuth('https://example.com')).toBe(false);
	});
});
