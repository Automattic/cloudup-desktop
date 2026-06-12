import { positionWindowBelowTray, toggleWindow } from './window';

function makeMockWin(visible = false) {
	return {
		isVisible: jest.fn(() => visible),
		hide: jest.fn(),
		show: jest.fn(),
		focus: jest.fn(),
		getBounds: jest.fn(() => ({ x: 0, y: 0, width: 420, height: 650 })),
		setPosition: jest.fn(),
	};
}

function makeMockTray(bounds = { x: 100, y: 20, width: 22, height: 22 }) {
	return {
		getBounds: jest.fn(() => bounds),
	};
}

describe('positionWindowBelowTray', () => {
	it('centers the window horizontally under the tray icon', () => {
		const win = makeMockWin();
		const tray = makeMockTray({ x: 100, y: 20, width: 22, height: 22 });

		positionWindowBelowTray(win as any, tray as any);

		// x = round(100 + 22/2 - 420/2) = round(100 + 11 - 210) = -99
		// y = round(20 + 22 + 4) = 46
		expect(win.setPosition).toHaveBeenCalledWith(-99, 46, false);
	});

	it('places window 4px below the bottom edge of the tray icon', () => {
		const win = makeMockWin();
		win.getBounds.mockReturnValue({ x: 0, y: 0, width: 200, height: 500 });
		const tray = makeMockTray({ x: 0, y: 0, width: 20, height: 20 });

		positionWindowBelowTray(win as any, tray as any);

		// y = round(0 + 20 + 4) = 24
		expect(win.setPosition).toHaveBeenCalledWith(expect.any(Number), 24, false);
	});

	it('rounds fractional coordinates to integers', () => {
		const win = makeMockWin();
		win.getBounds.mockReturnValue({ x: 0, y: 0, width: 420, height: 650 });
		// odd tray width to produce fractional midpoint
		const tray = makeMockTray({ x: 1, y: 0, width: 19, height: 20 });

		positionWindowBelowTray(win as any, tray as any);

		const [x, y] = (win.setPosition as jest.Mock).mock.calls[0];
		expect(Number.isInteger(x)).toBe(true);
		expect(Number.isInteger(y)).toBe(true);
	});

	it('uses tray and window bounds without side effects on win state', () => {
		const win = makeMockWin();
		const tray = makeMockTray();

		positionWindowBelowTray(win as any, tray as any);

		expect(tray.getBounds).toHaveBeenCalled();
		expect(win.getBounds).toHaveBeenCalled();
		expect(win.show).not.toHaveBeenCalled();
		expect(win.hide).not.toHaveBeenCalled();
	});
});

describe('toggleWindow', () => {
	it('hides the window when it is visible', () => {
		const win = makeMockWin(true);
		const tray = makeMockTray();

		toggleWindow(win as any, tray as any);

		expect(win.hide).toHaveBeenCalled();
		expect(win.show).not.toHaveBeenCalled();
		expect(win.focus).not.toHaveBeenCalled();
	});

	it('shows and focuses the window when it is hidden', () => {
		const win = makeMockWin(false);
		const tray = makeMockTray();

		toggleWindow(win as any, tray as any);

		expect(win.show).toHaveBeenCalled();
		expect(win.focus).toHaveBeenCalled();
		expect(win.hide).not.toHaveBeenCalled();
	});

	it('positions the window before showing it', () => {
		const win = makeMockWin(false);
		const tray = makeMockTray({ x: 200, y: 30, width: 22, height: 22 });

		toggleWindow(win as any, tray as any);

		const setPositionOrder = (win.setPosition as jest.Mock).mock.invocationCallOrder[0];
		const showOrder = (win.show as jest.Mock).mock.invocationCallOrder[0];
		expect(setPositionOrder).toBeLessThan(showOrder);
	});
});
