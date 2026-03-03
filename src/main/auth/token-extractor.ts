import { BrowserWindow } from 'electron';
import log from 'electron-log';

/** Seconds of clock skew to allow when checking JWT exp (e.g. 30s). */
const JWT_EXP_CLOCK_SKEW_SEC = 30;

/**
 * Decode JWT payload (no signature verification; we only need exp).
 * Returns null if token is invalid or missing exp.
 */
function getJwtExpiration(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Payload is base64url
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const decoded = JSON.parse(payload) as { exp?: number };
    if (typeof decoded.exp !== 'number') return null;
    return decoded.exp;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const exp = getJwtExpiration(token);
  if (exp === null) return false; // No exp = treat as not expired (e.g. opaque token)
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec >= exp - JWT_EXP_CLOCK_SKEW_SEC;
}

export class TokenExtractor {
  private win: BrowserWindow;
  private cachedToken: string | null = null;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * Extract auth token. Tries multiple methods:
   * 1. Check if we have a cached token from a previous extraction
   * 2. Try to get token from web app's api object
   * 3. Use the /refresh-token endpoint (relies on session cookies)
   */
  async getToken(): Promise<string | null> {
    // If we have a cached token, check expiration before returning
    if (this.cachedToken && isTokenExpired(this.cachedToken)) {
      log.debug('Cached token expired, re-extracting');
      this.cachedToken = null;
    }

    if (this.cachedToken) {
      return this.cachedToken;
    }

    if (this.win.isDestroyed()) return null;

    // Try to extract from the web app's internal API object
    try {
      // The api object stores the token internally after initialization
      // Try accessing it through various possible paths
      const token = await this.win.webContents.executeJavaScript(`
        (function() {
          // Try direct window.cldup_api_config (unlikely to exist)
          if (window.cldup_api_config?.accessToken) {
            return window.cldup_api_config.accessToken;
          }

          // Try to find the API module's exported token
          // The dashboard app may expose it through React context or global state
          if (window.__CLOUDUP_API_TOKEN__) {
            return window.__CLOUDUP_API_TOKEN__;
          }

          return null;
        })()
      `);

      if (token) {
        this.cachedToken = token;
        return token;
      }
    } catch (err) {
      // Webview extraction failed, will try refresh endpoint
      log.debug('Token extraction from webview failed', {
        error: (err as Error).message,
      });
    }

    // If webview extraction failed, try the refresh-token endpoint
    // This works because the session cookies are shared
    try {
      const token = await this.fetchTokenFromRefreshEndpoint();
      if (token) {
        this.cachedToken = token;
        return token;
      }
    } catch (err) {
      // Refresh endpoint failed
      log.debug('Token extraction from refresh endpoint failed', {
        error: (err as Error).message,
      });
    }

    // Return cached token if we have one and it's not expired
    if (this.cachedToken && !isTokenExpired(this.cachedToken)) {
      return this.cachedToken;
    }

    return null;
  }

  /**
   * Fetch a fresh token using the /refresh-token endpoint.
   * This endpoint uses session cookies to authenticate.
   */
  private async fetchTokenFromRefreshEndpoint(): Promise<string | null> {
    if (this.win.isDestroyed()) return null;
    return new Promise((resolve) => {
      // Use executeJavaScript to make the request with cookies
      this.win.webContents
        .executeJavaScript(
          `
        fetch('/refresh-token', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        })
        .then(r => r.json())
        .then(data => data.access_token || null)
        .catch(() => null)
      `
        )
        .then((token: string | null) => {
          resolve(token);
        })
        .catch(() => {
          resolve(null);
        });
    });
  }

  /**
   * Watch for auth state changes by monitoring page loads.
   * Re-extracts token after each navigation completes.
   */
  onAuthChange(callback: (token: string | null) => void): void {
    this.win.webContents.on('did-finish-load', async () => {
      if (this.win.isDestroyed()) return;
      // Small delay to let the app initialize
      setTimeout(async () => {
        if (this.win.isDestroyed()) return;
        const token = await this.getToken();
        if (this.win.isDestroyed()) return;
        callback(token);
      }, 1000);
    });
  }
}
