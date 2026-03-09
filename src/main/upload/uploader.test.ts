import { getMimeType, isNetworkUnreachableError, runWithConcurrency } from './uploader';

describe('getMimeType', () => {
  it('returns correct MIME for common image types', () => {
    expect(getMimeType('/photos/cat.png')).toBe('image/png');
    expect(getMimeType('/photos/cat.jpg')).toBe('image/jpeg');
    expect(getMimeType('/photos/cat.jpeg')).toBe('image/jpeg');
    expect(getMimeType('/photos/cat.gif')).toBe('image/gif');
    expect(getMimeType('/photos/cat.webp')).toBe('image/webp');
  });

  it('returns correct MIME for video types', () => {
    expect(getMimeType('clip.mp4')).toBe('video/mp4');
    expect(getMimeType('clip.mov')).toBe('video/quicktime');
    expect(getMimeType('clip.avi')).toBe('video/x-msvideo');
    expect(getMimeType('clip.mkv')).toBe('video/x-matroska');
    expect(getMimeType('clip.webm')).toBe('video/webm');
  });

  it('returns correct MIME for document types', () => {
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
    expect(getMimeType('archive.zip')).toBe('application/zip');
  });

  it('is case-insensitive for extensions', () => {
    expect(getMimeType('photo.PNG')).toBe('image/png');
    expect(getMimeType('photo.JPG')).toBe('image/jpeg');
    expect(getMimeType('clip.MP4')).toBe('video/mp4');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('file.docx')).toBe('application/octet-stream');
  });

  it('falls back for files with no extension', () => {
    expect(getMimeType('README')).toBe('application/octet-stream');
  });
});

describe('isNetworkUnreachableError', () => {
  function makeError(message: string, code?: string): Error {
    const err = new Error(message);
    if (code) (err as NodeJS.ErrnoException).code = code;
    return err;
  }

  it('detects ECONNREFUSED', () => {
    expect(isNetworkUnreachableError(makeError('connect failed', 'ECONNREFUSED'))).toBe(true);
  });

  it('detects ETIMEDOUT', () => {
    expect(isNetworkUnreachableError(makeError('timed out', 'ETIMEDOUT'))).toBe(true);
  });

  it('detects ENOTFOUND', () => {
    expect(isNetworkUnreachableError(makeError('dns lookup failed', 'ENOTFOUND'))).toBe(true);
  });

  it('detects ECONNRESET', () => {
    expect(isNetworkUnreachableError(makeError('connection reset', 'ECONNRESET'))).toBe(true);
  });

  it('detects "network" in message', () => {
    expect(isNetworkUnreachableError(makeError('Network error occurred'))).toBe(true);
  });

  it('detects "fetch failed" in message', () => {
    expect(isNetworkUnreachableError(makeError('fetch failed'))).toBe(true);
  });

  it('detects Chromium net:: errors in message', () => {
    expect(isNetworkUnreachableError(makeError('net::ERR_CONNECTION_REFUSED'))).toBe(true);
    expect(isNetworkUnreachableError(makeError('net::err_internet_disconnected'))).toBe(true);
  });

  it('returns false for non-network errors', () => {
    expect(isNetworkUnreachableError(makeError('File not found'))).toBe(false);
    expect(isNetworkUnreachableError(makeError('Permission denied', 'EACCES'))).toBe(false);
    expect(isNetworkUnreachableError(makeError('Upload failed: 413'))).toBe(false);
  });
});

describe('runWithConcurrency', () => {
  it('processes all items', async () => {
    const results: number[] = [];
    await runWithConcurrency(3, [1, 2, 3, 4, 5], async (item) => {
      results.push(item);
    });
    expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('limits concurrency', async () => {
    let active = 0;
    let maxActive = 0;

    await runWithConcurrency(2, [1, 2, 3, 4, 5], async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBe(2);
  });

  it('handles empty items', async () => {
    const results: number[] = [];
    await runWithConcurrency(3, [], async (item) => {
      results.push(item);
    });
    expect(results).toEqual([]);
  });

  it('passes correct index to task', async () => {
    const indices: number[] = [];
    await runWithConcurrency(2, ['a', 'b', 'c'], async (_item, index) => {
      indices.push(index);
    });
    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  it('caps workers at item count when concurrency exceeds items', async () => {
    let active = 0;
    let maxActive = 0;

    await runWithConcurrency(10, [1, 2], async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });

    expect(maxActive).toBe(2);
  });

  it('rejects when a task throws', async () => {
    await expect(
      runWithConcurrency(2, [1, 2, 3], async (item) => {
        if (item === 2) throw new Error('fail');
      })
    ).rejects.toThrow('fail');
  });
});
