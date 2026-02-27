import { Notification, BrowserWindow, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import log from 'electron-log';
import { TokenExtractor } from '../auth/token-extractor';
import { TokenStore } from '../auth/token-store';
import { CONFIG, isTrustedDomain } from '../../shared/config';

function isNetworkUnreachableError(err: Error): boolean {
  const msg = err.message?.toLowerCase() ?? '';
  const code = (err as NodeJS.ErrnoException).code?.toLowerCase() ?? '';
  return (
    code === 'econnrefused' ||
    code === 'etimedout' ||
    code === 'enotfound' ||
    code === 'econnreset' ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('net::err_')
  );
}

export class Uploader {
  private tokenExtractor: TokenExtractor;
  private win: BrowserWindow;
  private showWindow: () => void;
  private onUploadStarted?: () => void;
  private onUploadComplete?: () => void;
  private onUploadError?: () => void;
  /** Only one batch runs at a time (avoids 2× workers when drop fires twice). */
  private batchRunning = false;

  constructor(
    tokenExtractor: TokenExtractor,
    win: BrowserWindow,
    showWindow: () => void,
    callbacks?: {
      onUploadStarted?: () => void;
      onUploadComplete?: () => void;
      onUploadError?: () => void;
    }
  ) {
    this.tokenExtractor = tokenExtractor;
    this.win = win;
    this.showWindow = showWindow;
    this.onUploadStarted = callbacks?.onUploadStarted;
    this.onUploadComplete = callbacks?.onUploadComplete;
    this.onUploadError = callbacks?.onUploadError;
  }

  async upload(filePath: string): Promise<void> {
    return this.uploadMultiple([filePath]);
  }

  /**
   * Desktop upload path: only runs when user drops files on the tray icon or uses
   * "Upload File..." from the tray menu. Drops inside the webview use the web app's uploader.
   */
  async uploadMultiple(filePaths: string[]): Promise<void> {
    log.info('Upload requested', { paths: filePaths, count: filePaths.length });

    // Check network connectivity
    if (!net.isOnline()) {
      log.warn('Upload aborted: offline');
      this.showOfflineNotification();
      return;
    }

    // Filter out files that are too large
    const validFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const filePath of filePaths) {
      let stats: fs.Stats;
      try {
        stats = fs.statSync(filePath);
      } catch (err) {
        log.warn('File inaccessible, skipping', {
          path: filePath,
          error: (err as Error).message,
        });
        continue;
      }
      if (stats.size > CONFIG.maxFileSize) {
        skippedFiles.push(filePath);
        log.warn('File too large, skipping', {
          path: filePath,
          size: stats.size,
          maxSize: CONFIG.maxFileSize,
        });
      } else {
        validFiles.push(filePath);
      }
    }

    if (skippedFiles.length > 0) {
      this.showFileTooLargeNotification(skippedFiles);
    }

    if (validFiles.length === 0) {
      log.warn('No valid files to upload');
      return;
    }

    // Get token from webview or cached store
    const webviewToken = await this.tokenExtractor.getToken();
    const cachedToken = TokenStore.load();
    const token = webviewToken || cachedToken;

    if (!token) {
      log.warn('Upload aborted: not authenticated');
      this.showLoginRequired();
      return;
    }

    if (this.batchRunning) {
      log.info('Upload already in progress, ignoring duplicate drop', { count: filePaths.length });
      return;
    }

    this.batchRunning = true;
    try {
      this.onUploadStarted?.();
      this.showWindow(); // Show webview so user can see upload progress

      await this.doUploadMultiple(validFiles);

      // The web app shows upload progress and completion in the UI;
      // no separate success notification needed here.
      this.onUploadComplete?.();
      log.info('Upload queued', { count: filePaths.length });
    } catch (err) {
      this.onUploadError?.();
      const error = err as { status?: number; message?: string; code?: string };

      if (error && error.status === 401) {
        // Token expired or invalidated elsewhere
        TokenStore.clear();
        this.showLoginRequired();
        log.warn('Upload failed: unauthorized');
        return;
      }

      if (error.code === 'WEBVIEW_NOT_READY') {
        this.showWebviewNotReadyNotification();
        log.warn('Upload failed: webview not ready', {
          error: error.message,
          count: filePaths.length,
        });
        return;
      }

      if (error.code === 'SERVER_UNREACHABLE') {
        this.showServerUnreachableNotification();
        log.warn('Upload failed: server unreachable', {
          error: error.message,
          code: error.code,
          count: filePaths.length,
        });
        return;
      }

      log.error('Upload failed', { error: error.message, code: error.code, count: filePaths.length });
      this.showUploadErrorMultiple(filePaths, error.message || 'Unknown error');
    } finally {
      this.batchRunning = false;
    }
  }

  /**
   * Stream a file from disk to S3 presigned URL with retry logic
   * @param filePath - Path to file on disk
   * @param s3Url - Presigned S3 PUT URL
   * @param onProgress - Optional progress callback (bytes uploaded, total bytes)
   * @param maxRetries - Maximum number of retry attempts (default: 1)
   * @returns Promise that resolves when upload completes
   */
  private async streamFileToS3(
    filePath: string,
    s3Url: string,
    onProgress?: (loaded: number, total: number) => void,
    maxRetries: number = 1
  ): Promise<void> {
    const stats = fs.statSync(filePath);
    const totalBytes = stats.size;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        log.debug('Retrying S3 upload', {
          filePath,
          attempt: attempt + 1,
          delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        await this.doStreamFileToS3(filePath, s3Url, totalBytes, onProgress);
        return; // Success
      } catch (err) {
        lastError = err as Error;
        const isRetryable =
          err instanceof Error &&
          (err.message.includes('ECONNRESET') ||
            err.message.includes('ETIMEDOUT') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('timed out') ||
            err.message.includes('network') ||
            (err as any).code === 'ECONNRESET' ||
            (err as any).code === 'ETIMEDOUT');

        if (!isRetryable || attempt >= maxRetries) {
          throw err;
        }

        log.warn('S3 upload failed, will retry', {
          filePath,
          attempt: attempt + 1,
          error: lastError.message,
        });
      }
    }

    throw lastError || new Error('S3 upload failed after retries');
  }

  /**
   * Internal method to perform a single S3 upload attempt
   */
  private async doStreamFileToS3(
    filePath: string,
    s3Url: string,
    totalBytes: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    let uploadedBytes = 0;

    return new Promise((resolve, reject) => {
      const url = new URL(s3Url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const fileStream = fs.createReadStream(filePath);

      // Check if hostname is in trusted domains for development
      const hostname = url.hostname;
      const acceptSelfSigned = CONFIG.allowInsecure && isTrustedDomain(hostname);

      const options: https.RequestOptions = {
        hostname: hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'PUT',
        headers: {
          'Content-Length': totalBytes,
        },
        // In development, accept self-signed certificates for trusted domains
        // This is safe because we only do this for explicitly trusted domains in development mode
        rejectUnauthorized: !acceptSelfSigned,
      };

      if (acceptSelfSigned) {
        log.debug('Accepting self-signed certificate for S3 upload', {
          hostname,
          s3Url: s3Url.substring(0, 100) + '...', // Log partial URL for debugging
        });
      }

      const req = client.request(options, (res) => {
        // Cancel the idle timeout once we start receiving the response.
        req.setTimeout(0);

        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            fileStream.destroy();
            resolve();
          } else {
            req.destroy();
            fileStream.destroy();
            const bodySnippet =
              responseData.length > 0
                ? responseData.slice(0, 200).replace(/\s+/g, ' ').trim()
                : '';
            const detail = bodySnippet ? ` — ${bodySnippet}` : '';
            if (res.statusCode === 403) {
              reject(
                new Error(
                  `S3 presigned URL expired (403). Please try uploading again.${detail}`
                )
              );
            } else {
              reject(
                new Error(
                  `S3 upload failed: ${res.statusCode} ${res.statusMessage || ''}${detail}`
                )
              );
            }
          }
        });
      });

      // Size-based timeout: min 60s + ~1s per MB, capped at 15 minutes.
      // Prevents hung TCP connections from permanently locking the uploader.
      const timeoutMs = Math.min(
        Math.max(60_000, Math.ceil(totalBytes / 1024)),
        15 * 60_000
      );
      req.setTimeout(timeoutMs, () => {
        fileStream.destroy();
        req.destroy(
          new Error(`S3 upload timed out after ${Math.round(timeoutMs / 1000)}s`)
        );
      });

      req.on('error', (err) => {
        fileStream.destroy();
        // Log certificate errors with hostname for debugging
        if (
          err instanceof Error &&
          (err.message.includes('certificate') ||
            err.message.includes('unable to verify'))
        ) {
          log.error('S3 upload certificate error', {
            hostname,
            s3Url: s3Url.substring(0, 100) + '...',
            error: err.message,
            trustedDomains: CONFIG.trustedDomains,
            acceptSelfSigned,
          });
        }
        reject(err);
      });

      // Track upload progress
      fileStream.on('data', (chunk) => {
        // fs.createReadStream always emits Buffer objects for binary files
        const chunkSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk as string);
        uploadedBytes += chunkSize;
        if (onProgress) {
          onProgress(uploadedBytes, totalBytes);
        }
      });

      fileStream.on('error', (err) => {
        req.destroy();
        reject(err);
      });

      // Pipe file stream to request
      fileStream.pipe(req);
    });
  }

  /**
   * Run a task for each item with at most `concurrency` tasks in flight.
   * When one finishes, the next starts.
   * If any task throws, the returned promise rejects and remaining tasks are not awaited.
   */
  private async runWithConcurrency<T>(
    concurrency: number,
    items: T[],
    task: (item: T, index: number) => Promise<void>
  ): Promise<void> {
    const workerCount = Math.min(concurrency, items.length);
    let nextIndex = 0;
    async function worker(): Promise<void> {
      while (nextIndex < items.length) {
        // Safe: only one worker runs at a time in the event loop, so nextIndex++ is not racy.
        const index = nextIndex++;
        await task(items[index], index);
      }
    }
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
  }

  /**
   * Wait for the web app's uploader global to become available.
   * On cold start or reload, the dashboard JS may still be loading.
   */
  private async waitForWebviewUploader(
    pollIntervalMs = 500,
    timeoutMs = 10_000
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ready = await this.win.webContents.executeJavaScript(
          `!!window.__cloudup_uploader__`
        );
        if (ready) return;
      } catch {
        // Webview may not be ready to execute JS yet (e.g. still navigating)
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw {
      message: 'Cloudup is still loading. Please try again in a moment.',
      code: 'WEBVIEW_NOT_READY',
    };
  }

  private async doUploadMultiple(filePaths: string[]): Promise<void> {
    // Step 1: Get upload plan from frontend (metadata only, no file data).
    // Skip files that are missing or inaccessible so we don't fail the whole batch.
    const pathsToUpload: string[] = [];
    const fileMetadata: Array<{ name: string; size: number; type: string }> = [];
    for (const filePath of filePaths) {
      try {
        const stats = fs.statSync(filePath);
        pathsToUpload.push(filePath);
        fileMetadata.push({
          name: path.basename(filePath),
          size: stats.size,
          type: this.getMimeType(filePath),
        });
      } catch (err) {
        log.warn('File inaccessible, skipping', {
          path: filePath,
          error: (err as Error).message,
        });
      }
    }
    if (pathsToUpload.length === 0) {
      log.warn('No accessible files to upload');
      return;
    }

    // Wait for the web app's uploader to be available (handles cold start race)
    await this.waitForWebviewUploader();

    let plan: {
      streamId: string;
      items: Array<{
        index: number;
        id: string | null;
        filename: string;
        size: number;
        mime: string;
        s3_url: string | null;
        error?: string;
      }>;
    };

    try {
      const result = await this.win.webContents.executeJavaScript(`
        (async function() {
          try {
            if (!window.__cloudup_uploader__) {
              return { error: 'Web app uploader not available. Please ensure you are logged in.' };
            }

            const fileMetadata = ${JSON.stringify(fileMetadata)};
            const plan = await window.__cloudup_uploader__.createUploadPlan(fileMetadata);

            return { success: true, plan };
          } catch (err) {
            return { error: err.message || String(err) };
          }
        })()
      `);

      if (result.error) {
        throw { message: result.error };
      }

      plan = result.plan;
    } catch (err) {
      const error = err as Error;
      log.error('Failed to create upload plan', { error: error.message });
      const code = isNetworkUnreachableError(error) ? 'SERVER_UNREACHABLE' : undefined;
      throw { message: error.message, ...(code && { code }) };
    }

    if (!plan || !plan.items || plan.items.length === 0) {
      // Most commonly indicates we failed to create a stream/items in the
      // web app (e.g. network/server unreachable) and the helper returned
      // an empty plan. Treat as server-unreachable from the desktop UX.
      throw { message: 'No items created in upload plan', code: 'SERVER_UNREACHABLE' };
    }

    // Validate 1:1 mapping so we never stream the wrong file to the wrong URL.
    // Also require indices to be unique and sequential (0, 1, ..., n-1).
    const indicesInRange =
      plan.items.length === pathsToUpload.length &&
      plan.items.every(
        (item) =>
          typeof item.index === 'number' &&
          item.index >= 0 &&
          item.index < pathsToUpload.length
      );
    const indicesUniqueAndSequential =
      indicesInRange &&
      [...plan.items.map((i) => i.index)]
        .sort((a, b) => a - b)
        .every((idx, i) => idx === i);
    if (!indicesUniqueAndSequential) {
      log.error('Upload plan invalid', {
        planItems: plan.items.length,
        filePaths: pathsToUpload.length,
        indices: plan.items.map((i) => i.index),
      });
      throw {
        message: 'Upload plan invalid. Please try again.',
        code: 'SERVER_UNREACHABLE',
      };
    }

    // Only upload items that have an S3 URL; surface errors for failed plan entries
    const itemsToUpload = plan.items.filter(
      (item): item is typeof item & { id: string; s3_url: string } =>
        !item.error && !!item.s3_url && !!item.id
    );
    for (const item of plan.items) {
      if (item.error) {
        const filePath = pathsToUpload[item.index];
        const filename = filePath ? path.basename(filePath) : item.filename;
        log.warn('Plan item failed', { index: item.index, filename, error: item.error });
        this.showUploadErrorMultiple(
          filePath ? [filePath] : [item.filename],
          item.error
        );
      }
    }
    if (itemsToUpload.length === 0) {
      log.warn('No items to upload; all plan entries failed', { count: plan.items.length });
      return;
    }

    // Step 2: Stream each file to S3 from main process (max 3 concurrent).
    // If any single file upload throws, the whole batch fails (Promise.all); remaining files are not processed.
    const PROGRESS_THROTTLE_PERCENT = 5;
    const PROGRESS_THROTTLE_MS = 500;
    const CONCURRENCY = 3;

    await this.runWithConcurrency(CONCURRENCY, itemsToUpload, async (item) => {
      // item.index, item.s3_url, and item.id are guaranteed valid by the checks above
      const filePath = pathsToUpload[item.index];
      try {
        let lastSentPercent = -1;
        let lastSentTime = 0;

        // Stream file to S3 with progress tracking and retry logic
        await this.streamFileToS3(filePath, item.s3_url, (loaded, total) => {
          if (total <= 0) return;
          const percent = Math.floor((100 * loaded) / total);
          const now = Date.now();
          const shouldSend =
            percent >= 100 ||
            percent - lastSentPercent >= PROGRESS_THROTTLE_PERCENT ||
            now - lastSentTime >= PROGRESS_THROTTLE_MS;
          if (!shouldSend) return;
          lastSentPercent = percent;
          lastSentTime = now;

          const itemIdEscaped = JSON.stringify(item.id);
          this.win.webContents
            .executeJavaScript(`
              (async function() {
                if (!window.__cloudup_uploader__ || typeof window.__cloudup_uploader__.updateItemProgress !== 'function') return;
                await window.__cloudup_uploader__.updateItemProgress(${itemIdEscaped}, ${Math.min(100, percent)});
              })()
            `)
            .catch((err) => {
              log.debug('Failed to send upload progress update to webview', err);
            });
        });

        // Step 3: Mark item as complete via frontend helper
        const completeResult = await this.win.webContents.executeJavaScript(`
          (async function() {
            try {
              if (!window.__cloudup_uploader__) {
                return { error: 'Web app uploader not available' };
              }

              const success = await window.__cloudup_uploader__.markItemComplete(${JSON.stringify(item.id)});
              return { success };
            } catch (err) {
              return { error: err.message || String(err) };
            }
          })()
        `);

        if (completeResult.error) {
          log.warn('Failed to mark item complete', {
            itemId: item.id,
            error: completeResult.error,
          });
          // Don't throw - file is uploaded, just metadata update failed
          // The item will eventually be marked complete by the server or on next check
        }

        log.info('File uploaded successfully', {
          filename: item.filename,
          itemId: item.id,
        });
      } catch (err) {
        const error = err as Error;
        const isExpiredUrl = error.message.includes('expired');

        log.error('Failed to upload file to S3', {
          filename: item.filename,
          itemId: item.id,
          error: error.message,
          isExpiredUrl,
        });

        // If URL expired, we can't retry with the same item - would need to create a new one
        // For now, throw the error and let the caller handle it
        if (isExpiredUrl) {
          throw {
            message: `Upload failed: Presigned URL expired. Please try uploading ${item.filename} again.`,
            expired: true,
          };
        }

        throw {
          message: `Failed to upload ${item.filename}: ${error.message}`,
        };
      }
    });
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private showLoginRequired(): void {
    new Notification({
      title: 'Login Required',
      body: 'Please log in to upload files',
    }).show();
    this.showWindow();
  }

  private showOfflineNotification(): void {
    new Notification({
      title: 'You\'re Offline',
      body: 'Cannot upload while offline. Please try again when connected.',
    }).show();
  }

  private showFileTooLargeNotification(filePaths: string[]): void {
    const maxSizeMB = Math.round(CONFIG.maxFileSize / (1024 * 1024));
    const count = filePaths.length;
    if (count === 1) {
      const filename = path.basename(filePaths[0]);
      new Notification({
        title: 'File Too Large',
        body: `${filename} is too large to upload (maximum ${maxSizeMB}MB)`,
      }).show();
    } else {
      new Notification({
        title: 'Files Too Large',
        body: `${count} files are too large to upload (maximum ${maxSizeMB}MB each)`,
      }).show();
    }
  }

  private showUploadErrorMultiple(filePaths: string[], errorMessage: string): void {
    const count = filePaths.length;
    if (count === 1) {
      const filename = path.basename(filePaths[0]);
      new Notification({
        title: 'Upload Failed',
        body: `Failed to upload ${filename}: ${errorMessage}`,
      }).show();
    } else {
      new Notification({
        title: 'Upload Failed',
        body: `Failed to upload ${count} files: ${errorMessage}`,
      }).show();
    }
  }

  private showWebviewNotReadyNotification(): void {
    new Notification({
      title: 'Cloudup is Still Loading',
      body: 'Please wait a moment and try again.',
    }).show();
  }

  private showServerUnreachableNotification(): void {
    new Notification({
      title: 'Server unreachable',
      body: 'Cannot reach Cloudup. Check your connection or VPN and try again.',
    }).show();
  }
}
