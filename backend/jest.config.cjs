/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/auth.middleware.test.js',
    '**/auth.service.test.js',
    '**/http.middleware.test.js',
    '**/security-foundation.test.js',
    '**/tenant.integration.test.js',
    '**/vnext-relationship.integration.test.js',
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/config/seed.ts', '!src/config/migrate*.ts'],
  coverageDirectory: 'coverage',
};
