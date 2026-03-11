import { isTrustedDomain, isAppUrl, CONFIG, ENV } from './config';

describe('ENV and CONFIG', () => {
	it('resolves to development in test environment', () => {
		expect(ENV).toBe('development');
		expect(CONFIG.webAppUrl).toBe('https://cloudup.test');
		expect(CONFIG.apiUrl).toBe('https://api.cloudup.test');
	});

	it('has trusted domains in development', () => {
		expect(CONFIG.trustedDomains.length).toBeGreaterThan(0);
	});
});

describe('isTrustedDomain', () => {
	it('matches exact domain', () => {
		expect(isTrustedDomain('cloudup.test')).toBe(true);
	});

	it('matches subdomain via wildcard entry', () => {
		expect(isTrustedDomain('api.cloudup.test')).toBe(true);
	});

	it('matches deeply nested subdomain', () => {
		expect(isTrustedDomain('x.api.cloudup.test')).toBe(true);
	});

	it('matches other trusted domains', () => {
		expect(isTrustedDomain('cldup.test')).toBe(true);
		expect(isTrustedDomain('minio.test')).toBe(true);
	});

	it('rejects untrusted domains', () => {
		expect(isTrustedDomain('example.com')).toBe(false);
		expect(isTrustedDomain('cloudup.com')).toBe(false);
		expect(isTrustedDomain('evil-cloudup.test')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isTrustedDomain('')).toBe(false);
	});

	it('rejects domain with trailing dot (not in list)', () => {
		expect(isTrustedDomain('cloudup.test.')).toBe(false);
	});
});

describe('isAppUrl', () => {
	it('matches the web app origin', () => {
		expect(isAppUrl('https://cloudup.test')).toBe(true);
	});

	it('matches web app with path', () => {
		expect(isAppUrl('https://cloudup.test/login')).toBe(true);
		expect(isAppUrl('https://cloudup.test/streams/abc')).toBe(true);
	});

	it('rejects different subdomain', () => {
		expect(isAppUrl('https://api.cloudup.test')).toBe(false);
	});

	it('rejects different protocol', () => {
		expect(isAppUrl('http://cloudup.test')).toBe(false);
	});

	it('rejects non-http protocols', () => {
		expect(isAppUrl('file:///offline.html')).toBe(false);
		expect(isAppUrl('ftp://cloudup.test')).toBe(false);
	});

	it('returns false for invalid URLs', () => {
		expect(isAppUrl('not-a-url')).toBe(false);
		expect(isAppUrl('')).toBe(false);
	});
});
