const Store = jest.fn().mockImplementation(() => ({
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
}));

export default Store;
