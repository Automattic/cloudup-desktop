import {
	parseScreencapturePrefs,
	isScreenshotFile,
	type IsScreenshotOpts,
} from './detector';

describe('parseScreencapturePrefs', () => {
	it('parses typical defaults output', () => {
		const stdout = `{
    location = "/Users/alex/Screenshots";
    name = "Screenshot";
    type = jpg;
}`;
		expect(parseScreencapturePrefs(stdout)).toEqual({
			location: '/Users/alex/Screenshots',
			name: 'Screenshot',
			type: 'jpg',
		});
	});

	it('handles quoted keys', () => {
		const stdout = `{
    "location" = "~/Desktop";
}`;
		expect(parseScreencapturePrefs(stdout)).toEqual({ location: '~/Desktop' });
	});

	it('handles unquoted values', () => {
		const stdout = `{
    type = png;
}`;
		expect(parseScreencapturePrefs(stdout)).toEqual({ type: 'png' });
	});

	it('returns empty object for empty output', () => {
		expect(parseScreencapturePrefs('')).toEqual({});
	});

	it('ignores unrecognized keys', () => {
		const stdout = `{
    disable-shadow = 1;
    type = png;
}`;
		expect(parseScreencapturePrefs(stdout)).toEqual({ type: 'png' });
	});

	it('handles partial preferences', () => {
		const stdout = `{
    type = heic;
}`;
		expect(parseScreencapturePrefs(stdout)).toEqual({ type: 'heic' });
	});

	it('strips quotes from value and uses capture group', () => {
		const stdout = 'name = "My Screenshot";';
		const got = parseScreencapturePrefs(stdout);
		expect(got.name).toBe('My Screenshot');
	});

	it('matches line with multiple spaces around =', () => {
		const stdout = '  location  =  "/x";  ';
		const got = parseScreencapturePrefs(stdout);
		expect(got.location).toBe('/x');
	});

	it('strips only when value has both leading and trailing quote', () => {
		// Value is three quote chars: opening " + literal " + closing " → stripped to "
		const stdout = 'name = """;';
		const got = parseScreencapturePrefs(stdout);
		expect(got.name).toBe('"');
	});

	it('does not match line with trailing content after semicolon', () => {
		const stdout = 'location = "/a"; junk';
		expect(parseScreencapturePrefs(stdout)).toEqual({});
	});

	it('matches when no space after =', () => {
		const stdout = 'type =png;';
		expect(parseScreencapturePrefs(stdout)).toEqual({ type: 'png' });
	});

	it('trims whitespace from captured value', () => {
		const stdout = 'name =  hello  ;';
		const got = parseScreencapturePrefs(stdout);
		expect(got.name).toBe('hello');
	});

	it('does not strip when value has only a leading quote', () => {
		const stdout = 'name = "hello;';
		const got = parseScreencapturePrefs(stdout);
		expect(got.name).toBe('"hello');
	});

	it('does not strip when value has only a trailing quote', () => {
		const stdout = 'name = hello";';
		const got = parseScreencapturePrefs(stdout);
		expect(got.name).toBe('hello"');
	});

	it('requires key at start of line (after trim)', () => {
		const stdout = 'junk location = "/a";';
		expect(parseScreencapturePrefs(stdout)).toEqual({});
	});
});

describe('isScreenshotFile', () => {
	const defaultOpts: IsScreenshotOpts = {
		isDedicatedDir: false,
		namePrefix: null,
		extension: '.png',
	};

	describe('on Desktop (non-dedicated directory)', () => {
		it('matches macOS "Screenshot" prefix', () => {
			expect(isScreenshotFile('Screenshot 2024-01-15 at 10.30.00.png', defaultOpts)).toBe(true);
		});

		it('matches macOS "Screen Shot" prefix (pre-Ventura)', () => {
			expect(isScreenshotFile('Screen Shot 2024-01-15 at 10.30.00.png', defaultOpts)).toBe(true);
		});

		it('matches screen recording', () => {
			expect(isScreenshotFile('Screen Recording 2024-01-15.png', defaultOpts)).toBe(true);
		});

		it('is case-insensitive for prefix', () => {
			expect(isScreenshotFile('screenshot 2024-01-15.png', defaultOpts)).toBe(true);
			expect(isScreenshotFile('SCREENSHOT 2024-01-15.png', defaultOpts)).toBe(true);
		});

		it('extracts basename from full path', () => {
			expect(isScreenshotFile('/Users/alex/Desktop/Screenshot 2024-01-15.png', defaultOpts)).toBe(true);
			expect(isScreenshotFile('/Users/alex/Desktop/document.png', defaultOpts)).toBe(false);
		});

		it('rejects non-screenshot files', () => {
			expect(isScreenshotFile('document.png', defaultOpts)).toBe(false);
			expect(isScreenshotFile('photo.png', defaultOpts)).toBe(false);
			expect(isScreenshotFile('my-image.png', defaultOpts)).toBe(false);
		});

		it('matches short basename when prefix matches (non-dedicated dir)', () => {
			expect(isScreenshotFile('screen.png', defaultOpts)).toBe(true);
		});

		it('rejects wrong extension', () => {
			expect(isScreenshotFile('Screenshot 2024-01-15.jpg', defaultOpts)).toBe(false);
		});

		it('uses custom name prefix when set', () => {
			const opts: IsScreenshotOpts = { ...defaultOpts, namePrefix: 'Bildschirmfoto' };
			expect(isScreenshotFile('Bildschirmfoto 2024-01-15.png', opts)).toBe(true);
			// "screen" prefix still works alongside custom prefix
			expect(isScreenshotFile('Screenshot 2024-01-15.png', opts)).toBe(true);
		});
	});

	describe('in dedicated screenshot directory', () => {
		const dedicatedOpts: IsScreenshotOpts = {
			isDedicatedDir: true,
			namePrefix: null,
			extension: '.png',
		};

		it('matches any file with right extension and sufficient length', () => {
			expect(isScreenshotFile('Screenshot 2024-01-15 at 10.30.00.png', dedicatedOpts)).toBe(true);
			expect(isScreenshotFile('CleanShot 2024-01-15.png', dedicatedOpts)).toBe(true);
		});

		it('rejects short filenames', () => {
			expect(isScreenshotFile('a.png', dedicatedOpts)).toBe(false);
			expect(isScreenshotFile('short-name.png', dedicatedOpts)).toBe(false);
			expect(isScreenshotFile('12345678901.png', dedicatedOpts)).toBe(false);
		});

		it('accepts basename of length 12 in dedicated dir', () => {
			expect(isScreenshotFile('123456789012.png', dedicatedOpts)).toBe(true);
		});

		it('rejects wrong extension', () => {
			expect(isScreenshotFile('Screenshot 2024-01-15.jpg', dedicatedOpts)).toBe(false);
		});
	});

	describe('with non-default extension', () => {
		it('respects configured extension', () => {
			const opts: IsScreenshotOpts = { ...defaultOpts, extension: '.jpg' };
			expect(isScreenshotFile('Screenshot 2024-01-15.jpg', opts)).toBe(true);
			expect(isScreenshotFile('Screenshot 2024-01-15.png', opts)).toBe(false);
		});
	});
});
