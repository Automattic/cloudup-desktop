import { isTokenExpired } from './token-extractor';

function makeJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${header}.${body}.fake-signature`;
}

describe('isTokenExpired', () => {
	it('returns false for token with future exp', () => {
		const futureExp = Math.floor(Date.now() / 1000) + 3600;
		expect(isTokenExpired(makeJwt({ exp: futureExp }))).toBe(false);
	});

	it('returns true for token with past exp', () => {
		const pastExp = Math.floor(Date.now() / 1000) - 3600;
		expect(isTokenExpired(makeJwt({ exp: pastExp }))).toBe(true);
	});

	it('returns true when exp is within the 30s clock-skew window', () => {
		const soonExp = Math.floor(Date.now() / 1000) + 10;
		expect(isTokenExpired(makeJwt({ exp: soonExp }))).toBe(true);
	});

	it('returns false when exp is just beyond the clock-skew window', () => {
		const safeExp = Math.floor(Date.now() / 1000) + 60;
		expect(isTokenExpired(makeJwt({ exp: safeExp }))).toBe(false);
	});

	it('returns true when exp is exactly at clock-skew boundary (30s)', () => {
		const boundaryExp = Math.floor(Date.now() / 1000) + 30;
		expect(isTokenExpired(makeJwt({ exp: boundaryExp }))).toBe(true);
	});

	it('returns false for token with wrong number of segments', () => {
		expect(isTokenExpired('a.b')).toBe(false);
	});

	it('returns false for token with exp as non-number in payload', () => {
		expect(isTokenExpired(makeJwt({ exp: '123' }))).toBe(false);
	});

	it('returns false for token without exp claim', () => {
		expect(isTokenExpired(makeJwt({ sub: 'user123' }))).toBe(false);
	});

	it('returns false for opaque (non-JWT) token', () => {
		expect(isTokenExpired('opaque-token-string')).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isTokenExpired('')).toBe(false);
	});

	it('returns false for malformed base64 payload', () => {
		expect(isTokenExpired('header.!!!.signature')).toBe(false);
	});
});
