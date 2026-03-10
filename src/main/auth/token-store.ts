import { app, safeStorage } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import { isTokenExpired } from './token-extractor';

interface StoreSchema {
  encrypted_token: string;
  plaintext_token: string;
}

// electron-store extends Conf which has get/set/delete methods
// TypeScript may have trouble resolving the full type chain, so we use a type assertion
const store = new Store<StoreSchema>({
	name: 'cloudup-auth',
	defaults: {
		encrypted_token: '',
		plaintext_token: '',
	},
}) as Store<StoreSchema> & {
  get(key: keyof StoreSchema): StoreSchema[keyof StoreSchema];
  set(key: keyof StoreSchema, value: string): void;
  delete(key: keyof StoreSchema): void;
};

// Use encryption when packaged (signed build) and safeStorage is available.
// Use plaintext when unpackaged (e.g. local dev) to avoid keychain "authenticity cannot be verified" dialog.
const useEncryption = (): boolean => app.isPackaged && safeStorage.isEncryptionAvailable();

function saveToken(token: string): void {
	if (useEncryption()) {
		const encrypted = safeStorage.encryptString(token);
		store.set('encrypted_token', encrypted.toString('base64'));
		log.debug('Token saved to secure storage');
	} else {
		store.set('plaintext_token', token);
		log.debug('Token saved to plaintext storage (unpackaged)');
	}
}

function loadToken(): string | null {
	if (useEncryption()) {
		const encrypted = store.get('encrypted_token');
		if (encrypted) {
			return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
		}
	} else {
		const plain = store.get('plaintext_token');
		if (plain) return plain;
	}
	return null;
}

export const TokenStore = {
	save(token: string): void {
		try {
			saveToken(token);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			log.error('Failed to save token', { error: message });
		}
	},

	load(): string | null {
		try {
			const token = loadToken();
			if (token && isTokenExpired(token)) {
				log.debug('Stored token expired, clearing');
				this.clear();
				return null;
			}
			if (token) {
				log.debug('Token loaded from storage');
			}
			return token;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			log.error('Failed to load token', { error: message });
			return null;
		}
	},

	clear(): void {
		try {
			store.delete('encrypted_token');
			store.delete('plaintext_token');
			log.debug('Token cleared from storage');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			log.error('Failed to clear token', { error: message });
		}
	},
};
