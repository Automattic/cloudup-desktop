/**
 * TokenStore uses electron-store and electron safeStorage. Jest uses __mocks__
 * for those. We override electron-store here so the store retains values across
 * save/load/clear for assertions.
 */
const store: Record<string, string> = {};
let storeInstance: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
jest.mock('electron-store', () => ({
	__esModule: true,
	default: jest.fn(function (this: unknown) {
		storeInstance = {
			get: jest.fn((k: string) => store[k]),
			set: jest.fn((k: string, v: string) => {
				store[k] = v;
			}),
			delete: jest.fn((k: string) => {
				delete store[k];
			}),
		};
		return storeInstance;
	}),
}));

import { TokenStore } from './token-store';
import log from 'electron-log';

const mockLog = log as unknown as { debug: jest.Mock; error: jest.Mock };

function makeExpiredJwt(): string {
	const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
	const pastExp = Math.floor(Date.now() / 1000) - 3600;
	const body = Buffer.from(JSON.stringify({ exp: pastExp })).toString('base64url');
	return `${header}.${body}.sig`;
}

function getStoreInstance(): { get: jest.Mock; set: jest.Mock; delete: jest.Mock } {
	return storeInstance;
}

beforeEach(() => {
	delete store['encrypted_token'];
	delete store['plaintext_token'];
	mockLog.debug.mockClear();
	mockLog.error.mockClear();
});

describe('TokenStore', () => {
	it('load returns null when nothing saved', () => {
		expect(TokenStore.load()).toBe(null);
		expect(mockLog.debug).not.toHaveBeenCalledWith('Token loaded from storage');
	});

	it('save then load returns the token', () => {
		TokenStore.save('my-token');
		expect(mockLog.debug).toHaveBeenCalledWith('Token saved to plaintext storage (unpackaged)');
		mockLog.debug.mockClear();
		expect(TokenStore.load()).toBe('my-token');
		expect(mockLog.debug).toHaveBeenCalledWith('Token loaded from storage');
	});

	it('clear then load returns null', () => {
		TokenStore.save('my-token');
		mockLog.debug.mockClear();
		TokenStore.clear();
		expect(mockLog.debug).toHaveBeenCalledWith('Token cleared from storage');
		expect(TokenStore.load()).toBe(null);
	});

	it('load returns null and clears when stored token is expired', () => {
		const expired = makeExpiredJwt();
		TokenStore.save(expired);
		mockLog.debug.mockClear();
		expect(TokenStore.load()).toBe(null);
		expect(mockLog.debug).toHaveBeenCalledWith('Stored token expired, clearing');
	});

	it('save does not throw when store.set throws', () => {
		getStoreInstance().set.mockImplementationOnce(() => {
			throw new Error('storage full');
		});
		expect(() => TokenStore.save('my-token')).not.toThrow();
		expect(mockLog.error).toHaveBeenCalledWith('Failed to save token', { error: 'storage full' });
		expect(TokenStore.load()).toBe(null);
	});

	it('load returns null when store.get throws', () => {
		TokenStore.save('my-token');
		getStoreInstance().get.mockImplementationOnce(() => {
			throw new Error('read failed');
		});
		expect(TokenStore.load()).toBe(null);
		expect(mockLog.error).toHaveBeenCalledWith('Failed to load token', { error: 'read failed' });
	});

	it('clear does not throw when store.delete throws', () => {
		TokenStore.save('my-token');
		getStoreInstance().delete.mockImplementationOnce(() => {
			throw new Error('delete failed');
		});
		expect(() => TokenStore.clear()).not.toThrow();
		expect(mockLog.error).toHaveBeenCalledWith('Failed to clear token', { error: 'delete failed' });
		expect(TokenStore.load()).toBe('my-token');
	});
});

describe('TokenStore with encryption', () => {
	let TokenStoreEnc: typeof TokenStore;
	let encLog: { debug: jest.Mock; error: jest.Mock };

	beforeAll(() => {
		jest.resetModules();
		const electronMock = jest.requireActual('../../../__mocks__/electron');
		jest.doMock('electron', () => ({
			...electronMock,
			app: { ...electronMock.app, isPackaged: true },
			safeStorage: {
				isEncryptionAvailable: () => true,
				encryptString: (s: string) => Buffer.from(s, 'utf8'),
				decryptString: (b: Buffer) => b.toString('utf8'),
			},
		}));
		const storeMod = require('./token-store');
		TokenStoreEnc = storeMod.TokenStore;
		encLog = require('electron-log').default;
	});

	beforeEach(() => {
		delete store['encrypted_token'];
		delete store['plaintext_token'];
	});

	it('save then load returns the token (encrypted path)', () => {
		TokenStoreEnc.save('secret-token');
		expect(store['plaintext_token']).toBeUndefined();
		expect(store['encrypted_token']).toBeDefined();
		expect(encLog.debug).toHaveBeenCalledWith('Token saved to secure storage');
		expect(TokenStoreEnc.load()).toBe('secret-token');
	});

	it('load returns null when encrypted_token is empty', () => {
		store['encrypted_token'] = '';
		expect(TokenStoreEnc.load()).toBe(null);
	});

	it('clear removes encrypted token', () => {
		TokenStoreEnc.save('secret-token');
		TokenStoreEnc.clear();
		expect(TokenStoreEnc.load()).toBe(null);
	});
});

describe('TokenStore unpackaged with encryption available', () => {
	let TokenStoreUnpacked: typeof TokenStore;

	beforeAll(() => {
		jest.resetModules();
		const electronMock = jest.requireActual('../../../__mocks__/electron');
		jest.doMock('electron', () => ({
			...electronMock,
			app: { ...electronMock.app, isPackaged: false },
			safeStorage: {
				...electronMock.safeStorage,
				isEncryptionAvailable: () => true,
			},
		}));
		const storeMod = require('./token-store');
		TokenStoreUnpacked = storeMod.TokenStore;
	});

	beforeEach(() => {
		delete store['encrypted_token'];
		delete store['plaintext_token'];
	});

	it('uses plaintext storage when unpackaged even if encryption is available', () => {
		TokenStoreUnpacked.save('my-token');
		expect(store['plaintext_token']).toBe('my-token');
		expect(store['encrypted_token']).toBeUndefined();
		expect(TokenStoreUnpacked.load()).toBe('my-token');
	});
});
