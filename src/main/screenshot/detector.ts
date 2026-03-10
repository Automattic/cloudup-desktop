import { watch, type FSWatcher } from 'chokidar';
import { app } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log';

const execAsync = promisify(exec);

export type ScreencapturePrefs = {
  location?: string;
  name?: string;
  type?: string;
};

/**
 * Parse the output of `defaults read com.apple.screencapture`
 * into structured preferences.
 */
export function parseScreencapturePrefs(stdout: string): ScreencapturePrefs {
	const prefs: ScreencapturePrefs = {};

	for (const rawLine of stdout.split('\n')) {
		const line = rawLine.trim();
		const match = line.match(/^"?(location|name|type)"?\s*=\s*(.+);$/);
		if (!match) continue;

		const key = match[1] as keyof ScreencapturePrefs;
		let value = match[2].trim();

		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1);
		}

		prefs[key] = value;
	}

	return prefs;
}

export type IsScreenshotOpts = {
  isDedicatedDir: boolean;
  namePrefix: string | null;
  extension: string;
};

/**
 * Determine whether a file looks like a screenshot based on filename heuristics.
 */
export function isScreenshotFile(filePath: string, opts: IsScreenshotOpts): boolean {
	const filename = path.basename(filePath);
	const lower = filename.toLowerCase();

	if (!lower.endsWith(opts.extension)) {
		return false;
	}

	const baseName = filename.slice(0, filename.length - opts.extension.length);

	if (opts.isDedicatedDir) {
		return baseName.length >= 12;
	}

	const prefixes: string[] = [];
	if (opts.namePrefix) {
		prefixes.push(opts.namePrefix.toLowerCase());
	}
	prefixes.push('screen');

	return prefixes.some((prefix) => lower.startsWith(prefix));
}

export class ScreenshotDetector {
	private watcher: FSWatcher | null = null;
	private isDedicatedScreenshotDir = false;
	private screenshotNamePrefix: string | null = null;
	private screenshotFileExtension = '.png';

	/**
   * Read all screenshot-related preferences from the com.apple.screencapture domain
   * in a single call and extract the fields we care about.
   */
	private async readScreencapturePrefs(): Promise<ScreencapturePrefs | null> {
		if (process.platform !== 'darwin') {
			return null;
		}

		try {
			const { stdout } = await execAsync('defaults read com.apple.screencapture');
			const prefs = parseScreencapturePrefs(stdout);

			log.debug('Parsed com.apple.screencapture preferences', {
				hasLocation: !!prefs.location,
				hasName: !!prefs.name,
				hasType: !!prefs.type,
			});

			return prefs;
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error.code !== 'ENOENT' && !error.message.includes('does not exist')) {
				log.debug('Could not read com.apple.screencapture preferences, using defaults', {
					error: error.message,
				});
			}
			return null;
		}
	}

	async start(onScreenshot: (filePath: string) => void): Promise<void> {
		const desktopPath = app.getPath('desktop');

		// Read all preferences (location, name, type) in one call
		const prefs = await this.readScreencapturePrefs();

		let customLocation: string | null = null;
		if (prefs?.location) {
			const location = prefs.location;
			const expandedPath = location.startsWith('~')
				? location.replace(/^~/, app.getPath('home'))
				: path.resolve(location);

			log.debug('Screenshot location from system preference', {
				original: location,
				expanded: expandedPath,
			});
			customLocation = expandedPath;
		}

		// Determine if we are watching a dedicated screenshot directory
		// (i.e. location is set and not Desktop)
		if (customLocation && path.resolve(customLocation) !== desktopPath) {
			this.isDedicatedScreenshotDir = true;
		} else {
			this.isDedicatedScreenshotDir = false;
		}

		// Store optional name and type preferences
		this.screenshotNamePrefix = prefs?.name ?? null;
		const type = (prefs?.type || 'png').toLowerCase();
		this.screenshotFileExtension = `.${type}`;

		// Build watch paths: if we have an explicit screenshot dir, use that alone;
		// otherwise use Desktop (and default Pictures/Screenshots when location is unset) as fallback
		let watchPaths: string[];
		if (this.isDedicatedScreenshotDir && customLocation) {
			watchPaths = [customLocation];
		} else {
			watchPaths = [desktopPath];
			if (!customLocation) {
				watchPaths.push(path.join(app.getPath('home'), 'Pictures', 'Screenshots'));
			}
		}

		log.info('Watching screenshot locations', { paths: watchPaths });

		this.watcher = watch(watchPaths, {
			ignored: /(^|[/\\])\../, // ignore dotfiles
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 500 },
		});

		this.watcher.on('add', (filePath: string) => {
			if (this.isScreenshot(filePath)) {
				onScreenshot(filePath);
			}
		});

		this.watcher.on('error', (error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			log.error('Screenshot watcher error', { error: message });
		});
	}

	private isScreenshot(filePath: string): boolean {
		return isScreenshotFile(filePath, {
			isDedicatedDir: this.isDedicatedScreenshotDir,
			namePrefix: this.screenshotNamePrefix,
			extension: this.screenshotFileExtension,
		});
	}

	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}
}
