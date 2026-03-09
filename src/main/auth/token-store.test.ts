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
});

describe('TokenStore', () => {
  it('load returns null when nothing saved', () => {
    expect(TokenStore.load()).toBe(null);
  });

  it('save then load returns the token', () => {
    TokenStore.save('my-token');
    expect(TokenStore.load()).toBe('my-token');
  });

  it('clear then load returns null', () => {
    TokenStore.save('my-token');
    TokenStore.clear();
    expect(TokenStore.load()).toBe(null);
  });

  it('load returns null and clears when stored token is expired', () => {
    const expired = makeExpiredJwt();
    TokenStore.save(expired);
    expect(TokenStore.load()).toBe(null);
    expect(TokenStore.load()).toBe(null);
  });

  it('save does not throw when store.set throws', () => {
    getStoreInstance().set.mockImplementationOnce(() => {
      throw new Error('storage full');
    });
    expect(() => TokenStore.save('my-token')).not.toThrow();
    expect(TokenStore.load()).toBe(null);
  });

  it('load returns null when store.get throws', () => {
    TokenStore.save('my-token');
    getStoreInstance().get.mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    expect(TokenStore.load()).toBe(null);
  });

  it('clear does not throw when store.delete throws', () => {
    TokenStore.save('my-token');
    getStoreInstance().delete.mockImplementationOnce(() => {
      throw new Error('delete failed');
    });
    expect(() => TokenStore.clear()).not.toThrow();
    expect(TokenStore.load()).toBe('my-token');
  });
});

describe('TokenStore with encryption', () => {
  let TokenStoreEnc: typeof TokenStore;

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
  });

  beforeEach(() => {
    delete store['encrypted_token'];
    delete store['plaintext_token'];
  });

  it('save then load returns the token (encrypted path)', () => {
    TokenStoreEnc.save('secret-token');
    expect(store['plaintext_token']).toBeUndefined();
    expect(store['encrypted_token']).toBeDefined();
    expect(TokenStoreEnc.load()).toBe('secret-token');
  });

  it('clear removes encrypted token', () => {
    TokenStoreEnc.save('secret-token');
    TokenStoreEnc.clear();
    expect(TokenStoreEnc.load()).toBe(null);
  });
});
