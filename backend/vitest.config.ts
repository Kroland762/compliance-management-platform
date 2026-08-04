import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/auth-tenant-context.test.js',
      'tests/cron-scheduler.service.test.js',
      'tests/data-source-security.service.test.js',
      'tests/evidence-preview.service.test.js',
      'tests/evidence-security.service.test.js',
      'tests/object-access.service.test.js',
      'tests/questionnaire-evidence.service.test.js',
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/config/seed.ts', 'src/config/migrate*.ts'],
    },
  },
});
