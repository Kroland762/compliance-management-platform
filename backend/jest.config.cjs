/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/config/seed.ts', '!src/config/migrate*.ts'],
  coverageDirectory: 'coverage',
};
