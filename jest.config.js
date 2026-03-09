/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  setupFiles: ['./jest.setup.js'],
};
