import {
	buildUploadMetadata,
	getMimeType,
	isNetworkUnreachableError,
	runWithConcurrency,
	formatFileSize,
} from './uploader';

describe('buildUploadMetadata', () => {
	it('marks the file as a screenshot when the detector flagged it', () => {
		// This flag is the entire trigger for private storage server-side; if it
		// stops being sent, screenshots silently go back to being public.
		expect(buildUploadMetadata('/tmp/Screen Shot.png', 1024, true)).toEqual({
			name: 'Screen Shot.png',
			size: 1024,
			type: 'image/png',
			screenshot: true,
		});
	});

	it('defaults to not-a-screenshot for ordinary uploads', () => {
		expect(buildUploadMetadata('/tmp/holiday.png', 2048)).toEqual({
			name: 'holiday.png',
			size: 2048,
			type: 'image/png',
			screenshot: false,
		});
	});
});

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

describe('formatFileSize', () => {
	it('formats bytes as MB for values under 1GB', () => {
		expect(formatFileSize(200_000_000)).toBe('200 MB');
		expect(formatFileSize(100_000_000)).toBe('100 MB');
	});

	it('formats bytes as GB for values 1GB and above', () => {
		expect(formatFileSize(4_900_000_000)).toBe('4.9 GB');
		expect(formatFileSize(5_000_000_000)).toBe('5.0 GB');
		expect(formatFileSize(1_000_000_000)).toBe('1.0 GB');
	});

	it('rolls over to GB when MB rounds to 1000', () => {
		expect(formatFileSize(999_999_999)).toBe('1.0 GB');
	});

	it('uses >= 1e9 so exactly 1 billion bytes is GB not MB', () => {
		expect(formatFileSize(1_000_000_000)).toBe('1.0 GB');
		expect(formatFileSize(1_000_000_000)).not.toBe('1000 MB');
	});

	it('just under 1e9 with 999 MB stays in MB', () => {
		expect(formatFileSize(999_000_000)).toBe('999 MB');
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

	it('handles error with no message (optional message)', () => {
		const err = Object.assign(new Error(), { message: undefined });
		expect(isNetworkUnreachableError(err)).toBe(false);
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
