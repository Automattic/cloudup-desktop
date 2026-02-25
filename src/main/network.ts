import { net, BrowserWindow } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { CONFIG } from '../shared/config';

export class NetworkManager {
  private win: BrowserWindow;
  private isOffline: boolean;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private probeInProgress = false;
  private onReconnected: (() => void) | null = null;
  private onShowOfflinePage: (() => void) | null = null;

  constructor(win: BrowserWindow) {
    this.win = win;
    this.isOffline = !net.isOnline();
  }

  start(callbacks?: { onReconnected?: () => void; onShowOfflinePage?: () => void }): void {
    this.onReconnected = callbacks?.onReconnected ?? null;
    this.onShowOfflinePage = callbacks?.onShowOfflinePage ?? null;
    log.info('Network manager started', { isOnline: !this.isOffline });

    // Poll for network status changes since net.on('online'/'offline') was removed
    // in newer Electron versions. Also retry when showing offline page (e.g. server
    // was down but machine stayed "online" - net.isOnline() never flips).
    this.checkInterval = setInterval(() => {
      const wasOffline = this.isOffline;
      this.isOffline = !net.isOnline();

      if (wasOffline && !this.isOffline) {
        log.info('Network came online');
        if (this.win.webContents.getURL().includes('offline.html')) {
          log.info('Reloading web app after coming online');
          this.reloadWebAppWithSanityCheck();
        }
      } else if (!wasOffline && this.isOffline) {
        log.info('Network went offline');
      }

      // When showing offline page (after a load failure or server-unreachable from upload etc),
      // probe periodically until the server is back, then reload and stop probing
      if (this.win.webContents.getURL().includes('offline.html') && !this.probeInProgress) {
        this.probeWebAppAndReloadIfReachable();
      }
    }, 3000);

    // Handle load failures (network errors)
    this.win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      // -106: ERR_INTERNET_DISCONNECTED
      // -105: ERR_NAME_NOT_RESOLVED
      // -102: ERR_CONNECTION_REFUSED
      if (errorCode === -106 || errorCode === -105 || errorCode === -102) {
        log.warn('Load failed due to network error', { errorCode, errorDescription });
        this.loadOfflinePage();
      }
    });

    // When the user is on the web app and a request to our origin fails (e.g. fetch, click),
    // show the offline page so we detect "server went down" without a full page load.
    // Chromium reports errors as "net::ERR_..." so we match by substring.
    const connectionErrorCodes = [
      'ERR_CONNECTION_REFUSED',
      'ERR_CONNECTION_RESET',
      'ERR_NAME_NOT_RESOLVED',
      'ERR_INTERNET_DISCONNECTED',
      'ERR_CONNECTION_TIMED_OUT',
      'ERR_NETWORK_CHANGED',
    ];
    const appOrigin = CONFIG.webAppUrl.replace(/\/$/, '');
    const apiOrigin = CONFIG.apiUrl.replace(/\/$/, '');
    // Match requests to our web app and API origins (* = any path)
    const urlFilter = {
      urls: [`${appOrigin}/*`, `${apiOrigin}/*`],
    };
    this.win.webContents.session.webRequest.onErrorOccurred(urlFilter, (details) => {
      log.debug('WebRequest error occurred', { error: details.error, url: details.url });
      const isConnectionError = connectionErrorCodes.some((code) =>
        details.error ? details.error.includes(code) : false
      );
      if (!isConnectionError) return;
      if (this.win.webContents.getURL().includes('offline.html')) return;
      if (!this.win.webContents.getURL().startsWith(appOrigin)) return;
      log.warn('Request failed due to connection error, showing offline page', {
        error: details.error,
        url: details.url,
      });
      this.loadOfflinePage();
    });
  }

  private loadOfflinePage(): void {
    const offlinePath = path.join(__dirname, '..', '..', 'assets', 'offline.html');
    this.win.loadFile(offlinePath);
    this.onShowOfflinePage?.();
  }

  /** Public so the uploader (or other code) can show the offline page when server is unreachable. */
  showOfflinePage(): void {
    this.loadOfflinePage();
  }

  /**
   * Probe the web app URL; if reachable (2xx/3xx), reload the window with a sanity check.
   * Used when we're on the offline page (e.g. server was down, net.isOnline() stayed true).
   */
  private probeWebAppAndReloadIfReachable(): void {
    this.probeInProgress = true;
    const request = net.request({
      url: CONFIG.webAppUrl,
      method: 'GET',
    });
    request.on('response', (response) => {
      this.probeInProgress = false;
      if (response.statusCode >= 200 && response.statusCode < 400) {
        log.info('Web app reachable, reloading');
        this.reloadWebAppWithSanityCheck();
      }
    });
    request.on('error', () => {
      this.probeInProgress = false;
    });
    request.end();
  }

  /**
   * Load the web app URL and, after load, verify the page is the real app (not an error or blank).
   * If the sanity check fails, show the offline page again so we keep retrying.
   */
  private reloadWebAppWithSanityCheck(): void {
    const once = () => {
      this.win.webContents.removeListener('did-finish-load', once);
      this.win.webContents
        .executeJavaScript(
          `(function() {
            var body = document.body;
            if (!body) return false;
            var text = body.innerText || '';
            if (text.indexOf('Slim Application Error') !== -1 || text.indexOf('Application Error') !== -1) return false;
            return !!(document.querySelector('#app') || document.querySelector('.landing') || document.querySelector('script#cldup-api-config'));
          })()`
        )
        .then((ok: boolean) => {
          if (!ok) {
            log.warn('Reconnect sanity check failed: page is not the app, showing offline again');
            this.loadOfflinePage();
          } else {
            this.onReconnected?.();
          }
        })
        .catch(() => {
          log.warn('Reconnect sanity check failed: check threw, showing offline again');
          this.loadOfflinePage();
        });
    };
    this.win.webContents.once('did-finish-load', once);
    this.win.loadURL(CONFIG.webAppUrl);
  }

  getIsOffline(): boolean {
    return this.isOffline;
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
