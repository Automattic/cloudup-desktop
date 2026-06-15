import * as fs from 'fs';
import { TrayManager } from './tray';

jest.mock('./window', () => ({ toggleWindow: jest.fn() }));

jest.mock('./preferences', () => ({
	getOpenAtLogin: jest.fn(() => false),
	setOpenAtLogin: jest.fn(),
	getAutoStreamScreenshots: jest.fn(() => null),
	setAutoStreamScreenshots: jest.fn(),
}));

jest.mock('../shared/file-dialog', () => ({
	getOpenFileDialogOptions: jest.fn(() => ({})),
}));

jest.mock('fs', () => ({
	...jest.requireActual('fs'),
	existsSync: jest.fn(() => true),
}));

// Module-level reference updated each time new Tray() is called — captured by closure.
let mockTrayInstance: {
	on: jest.Mock;
	_emit: (event: string, ...args: unknown[]) => void;
	setToolTip: jest.Mock;
	setImage: jest.Mock;
	popUpContextMenu: jest.Mock;
	destroy: jest.Mock;
};

jest.mock('electron', () => {
	const actual = jest.requireActual('../../__mocks__/electron');
	return {
		...actual,
		Tray: jest.fn().mockImplementation(() => {
			const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
			mockTrayInstance = {
				on: jest.fn((event: string, fn: (...args: unknown[]) => void) => {
					listeners[event] = [...(listeners[event] ?? []), fn];
				}),
				_emit: (event: string, ...args: unknown[]) => {
					(listeners[event] ?? []).forEach((fn) => fn(...args));
				},
				setToolTip: jest.fn(),
				setImage: jest.fn(),
				popUpContextMenu: jest.fn(),
				destroy: jest.fn(),
			};
			return mockTrayInstance;
		}),
		Menu: {
			buildFromTemplate: jest.fn().mockImplementation((template) => ({ template })),
			setApplicationMenu: jest.fn(),
		},
		nativeImage: {
			createFromPath: jest.fn().mockReturnValue({ setTemplateImage: jest.fn() }),
			createFromBuffer: jest.fn().mockReturnValue({ setTemplateImage: jest.fn() }),
		},
		app: { ...actual.app, showAboutPanel: jest.fn() },
		dialog: {
			showOpenDialog: jest.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
		},
	};
});

const mockFs = fs as jest.Mocked<typeof fs>;

function makeMockWin() {
	return {
		isDestroyed: jest.fn(() => false),
		isVisible: jest.fn(() => false),
		show: jest.fn(),
		hide: jest.fn(),
		focus: jest.fn(),
		getBounds: jest.fn(() => ({ x: 0, y: 0, width: 420, height: 650 })),
		setPosition: jest.fn(),
	};
}

describe('TrayManager', () => {
	let manager: TrayManager;
	let win: ReturnType<typeof makeMockWin>;

	beforeEach(() => {
		win = makeMockWin();
		manager = new TrayManager(win as any, jest.fn());
		mockFs.existsSync.mockReturnValue(true);
	});

	describe('create()', () => {
		it('returns the created tray', () => {
			const tray = manager.create();
			expect(tray).toBe(mockTrayInstance);
		});

		it('getTray() returns the tray after creation', () => {
			manager.create();
			expect(manager.getTray()).toBe(mockTrayInstance);
		});

		it('getTray() returns null before creation', () => {
			expect(manager.getTray()).toBeNull();
		});

		it('registers click, right-click, and drop-files handlers', () => {
			manager.create();
			expect(mockTrayInstance.on).toHaveBeenCalledWith('click', expect.any(Function));
			expect(mockTrayInstance.on).toHaveBeenCalledWith('right-click', expect.any(Function));
			expect(mockTrayInstance.on).toHaveBeenCalledWith('drop-files', expect.any(Function));
		});
	});

	describe('file drop', () => {
		it('calls the registered callback when files are dropped', () => {
			const callback = jest.fn();
			manager.onFileDrop(callback);
			manager.create();

			mockTrayInstance._emit('drop-files', {}, ['/path/to/file.png']);

			expect(callback).toHaveBeenCalledWith(['/path/to/file.png']);
		});

		it('does not call the callback when the drop has no files', () => {
			const callback = jest.fn();
			manager.onFileDrop(callback);
			manager.create();

			mockTrayInstance._emit('drop-files', {}, []);

			expect(callback).not.toHaveBeenCalled();
		});

		it('does not throw when no callback is registered', () => {
			manager.create();
			expect(() => mockTrayInstance._emit('drop-files', {}, ['/file.png'])).not.toThrow();
		});
	});

	describe('setState()', () => {
		it('updates the icon when the state changes', () => {
			manager.create();
			mockTrayInstance.setImage.mockClear();

			manager.setState('uploading');

			expect(mockTrayInstance.setImage).toHaveBeenCalledTimes(1);
		});

		it('is a no-op when the state has not changed', () => {
			manager.create();
			// initial state is 'idle'
			mockTrayInstance.setImage.mockClear();

			manager.setState('idle');

			expect(mockTrayInstance.setImage).not.toHaveBeenCalled();
		});

		it('cycles through states correctly', () => {
			manager.create();
			mockTrayInstance.setImage.mockClear();

			manager.setState('uploading');
			manager.setState('error');
			manager.setState('error'); // no-op
			manager.setState('idle');

			expect(mockTrayInstance.setImage).toHaveBeenCalledTimes(3);
		});
	});

	describe('destroy()', () => {
		it('calls tray.destroy() and nulls the reference', () => {
			manager.create();
			manager.destroy();

			expect(mockTrayInstance.destroy).toHaveBeenCalled();
			expect(manager.getTray()).toBeNull();
		});

		it('does not throw when called before create()', () => {
			expect(() => manager.destroy()).not.toThrow();
		});
	});

	describe('icon fallback', () => {
		it('uses createFromPath when the icon file exists', () => {
			const { nativeImage } = require('electron');
			mockFs.existsSync.mockReturnValue(true);

			manager.create();

			expect(nativeImage.createFromPath).toHaveBeenCalled();
			expect(nativeImage.createFromBuffer).not.toHaveBeenCalled();
		});

		it('uses createFromBuffer fallback when the icon file is missing', () => {
			const { nativeImage } = require('electron');
			mockFs.existsSync.mockReturnValue(false);

			manager.create();

			expect(nativeImage.createFromPath).not.toHaveBeenCalled();
			expect(nativeImage.createFromBuffer).toHaveBeenCalled();
		});
	});

	describe('context menu', () => {
		it('builds a context menu on right-click', () => {
			const { Menu } = require('electron');
			manager.create();
			mockTrayInstance._emit('right-click');

			expect(Menu.buildFromTemplate).toHaveBeenCalled();
			expect(mockTrayInstance.popUpContextMenu).toHaveBeenCalled();
		});

		it('context menu includes expected items', () => {
			const { Menu } = require('electron');
			manager.create();
			mockTrayInstance._emit('right-click');

			const template = Menu.buildFromTemplate.mock.calls[0][0];
			const labels = template
				.filter((item: any) => item.label)
				.map((item: any) => item.label);

			expect(labels).toContain('Show Cloudup');
			expect(labels).toContain('Upload File...');
			expect(labels).toContain('Open at Login');
			expect(labels).toContain('Auto-Stream Screenshots');
			expect(labels).toContain('Quit');
		});

		it('calls onAutoStreamToggle callback when the menu item is clicked', () => {
			const toggleCb = jest.fn();
			manager.onAutoStreamScreenshotsToggle(toggleCb);
			const { Menu } = require('electron');
			manager.create();
			mockTrayInstance._emit('right-click');

			const template = Menu.buildFromTemplate.mock.calls[0][0];
			const autoStreamItem = template.find(
				(item: any) => item.label === 'Auto-Stream Screenshots'
			);
			autoStreamItem.click({ checked: true });

			expect(toggleCb).toHaveBeenCalledWith(true);
		});

		it('calls onQuit when Quit menu item is clicked', () => {
			const onQuit = jest.fn();
			manager = new TrayManager(win as any, onQuit);
			const { Menu } = require('electron');
			manager.create();
			mockTrayInstance._emit('right-click');

			const template = Menu.buildFromTemplate.mock.calls[0][0];
			const quitItem = template.find((item: any) => item.label === 'Quit');
			quitItem.click();

			expect(onQuit).toHaveBeenCalled();
		});
	});
});
