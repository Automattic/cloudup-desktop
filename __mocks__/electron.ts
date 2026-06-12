export const app = {
  isPackaged: false,
  getPath: jest.fn(() => '/mock'),
  setLoginItemSettings: jest.fn(),
  getLoginItemSettings: jest.fn(() => ({ openAtLogin: false })),
  showAboutPanel: jest.fn(),
};
export const BrowserWindow = jest.fn();
export const contextBridge = { exposeInMainWorld: jest.fn() };
export const dialog = { showOpenDialog: jest.fn() };
export const globalShortcut = { register: jest.fn(), unregister: jest.fn() };
export const Menu = { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() };
export const nativeImage = {
  createFromPath: jest.fn().mockReturnValue({ setTemplateImage: jest.fn() }),
  createFromBuffer: jest.fn().mockReturnValue({ setTemplateImage: jest.fn() }),
};
export const net = {
  isOnline: jest.fn(() => true),
  request: jest.fn().mockReturnValue({ on: jest.fn(), end: jest.fn() }),
};
export const Notification = jest.fn().mockImplementation(() => ({ show: jest.fn() }));
export const safeStorage = {
  isEncryptionAvailable: jest.fn(() => false),
  encryptString: jest.fn(),
  decryptString: jest.fn(),
};
export const session = {
  defaultSession: { webRequest: { onErrorOccurred: jest.fn() } },
  fromPartition: jest.fn().mockReturnValue({
    setCertificateVerifyProc: jest.fn(),
    webRequest: { onErrorOccurred: jest.fn() },
  }),
};
export const shell = { openExternal: jest.fn() };
export const Tray = jest.fn();
