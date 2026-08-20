import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/auth-tenant-context.test.js',
      'tests/asset.service.test.js',
      'tests/cron-scheduler.service.test.js',
      'tests/account-contract.test.ts',
      'tests/account-problem.service.test.ts',
      'tests/csv-data-source.service.test.ts',
      'tests/data-source-security.service.test.js',
      'tests/department.routes.test.js',
      'tests/evidence-preview.service.test.js',
      'tests/evidence-security.service.test.js',
      'tests/evaluation-columns.test.js',
      'tests/evaluation-assignee.service.test.ts',
      'tests/evaluation-filters.test.js',
      'tests/work-item.service.test.ts',
      'tests/member-context.service.test.js',
      'tests/lookup.service.test.ts',
      'tests/migration-runner.test.ts',
      'tests/config.test.ts',
      'tests/object-access.service.test.js',
      'tests/questionnaire-evidence.service.test.js',
      'tests/template.service.test.js',
      'tests/product-compliance.service.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/config/seed.ts', 'src/config/migrate*.ts'],
    },
  },
});
