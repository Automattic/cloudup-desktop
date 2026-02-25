import Store from 'electron-store';
import { app } from 'electron';
import log from 'electron-log';

interface Preferences {
  openAtLogin: boolean;
  autoStreamScreenshots: boolean | null; // null = not set yet (ask permission), true/false = user's choice
}

const defaults: Preferences = {
  openAtLogin: false,
  autoStreamScreenshots: null, // null = not set yet, will ask on first screenshot
};

// electron-store extends Conf which has get/set methods
// TypeScript may have trouble resolving the full type chain, so we use a type assertion
const preferences = new Store<Preferences>({
  name: 'cloudup-preferences',
  defaults,
}) as Store<Preferences> & {
  get<K extends keyof Preferences>(key: K): Preferences[K];
  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void;
};

/**
 * Set whether the app should open at login
 */
export function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled });
  preferences.set('openAtLogin', enabled);
  log.info('Open at login preference changed', { enabled });
}

/**
 * Get current open at login setting
 */
export function getOpenAtLogin(): boolean {
  return preferences.get('openAtLogin');
}

/**
 * Set whether screenshots should be auto-streamed
 */
export function setAutoStreamScreenshots(enabled: boolean): void {
  preferences.set('autoStreamScreenshots', enabled);
  log.info('Auto-stream screenshots preference changed', { enabled });
}

/**
 * Get current auto-stream screenshots setting
 * Returns null if not set yet (first time), true/false for user's choice
 */
export function getAutoStreamScreenshots(): boolean | null {
  return preferences.get('autoStreamScreenshots');
}

/**
 * Initialize preferences on app start
 * Syncs the login item setting with the stored preference
 */
export function initPreferences(): void {
  const openAtLogin = getOpenAtLogin();
  app.setLoginItemSettings({ openAtLogin });
  log.info('Preferences initialized', {
    openAtLogin,
    autoStreamScreenshots: getAutoStreamScreenshots(),
  });
}
