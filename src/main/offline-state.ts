import { isAppUrl } from '../shared/config';

/**
 * True when the main window is showing the local offline fallback page
 * (set by NetworkManager when it loads offline.html, cleared when loading the app).
 */
let showingOfflinePage = false;

export function setShowingOfflinePage(value: boolean): void {
  showingOfflinePage = value;
}

export function isShowingOfflinePage(): boolean {
  return showingOfflinePage;
}

/**
 * True when the window URL is the real app and we're not showing the offline page.
 * Use for auth checks and token extraction.
 */
export function isAppReadyForAuth(url: string): boolean {
  return isAppUrl(url) && !showingOfflinePage;
}
