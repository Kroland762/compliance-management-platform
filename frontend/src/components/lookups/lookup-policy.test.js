import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewRoot = resolve(process.cwd(), 'src/views');
const guarded = [
  'AssetLedger.tsx', 'Findings.tsx', 'RemediationActions.tsx', 'QualificationLedger.tsx',
  'AssessmentWizard.tsx', 'OrganizationManagement.tsx', 'product-compliance/ProductList.tsx',
  'admin/UserManagement.tsx',
];

function viewFiles() {
  return guarded.map((file) => [file, readFileSync(resolve(viewRoot, file), 'utf8')]);
}

describe('dynamic lookup policy', () => {
  test('business pages do not call the legacy department lookup directly', () => {
    for (const [file, source] of viewFiles()) {
      expect(source, file).not.toContain('/lookup/departments');
      expect(source, file).not.toContain('/lookup/personnel');
    }
  });

  test('business selectors do not expose department codes in labels', () => {
    for (const file of guarded) {
      const source = readFileSync(resolve(viewRoot, file), 'utf8');
      expect(source, file).not.toMatch(/label\s*:\s*`[^`]*\.(?:code)[^`]*`/);
    }
  });

  test('business pages never concatenate a department code into a selector label', () => {
    for (const [file, source] of viewFiles()) {
      expect(source, file).not.toMatch(/\$\{(?:department|dept)\.code\}/);
    }
  });

  test('audited paged resources use the shared remote lookup contract', () => {
    const taskForm = readFileSync(resolve(viewRoot, 'account/TaskForm.tsx'), 'utf8');
    expect(taskForm).toContain('kind="account-data-sources"');
    expect(taskForm).toContain('kind="account-rules"');
    expect(taskForm).not.toMatch(/set(?:DataSources|Rules)\([^)]*response\.data/);

    const wizard = readFileSync(resolve(viewRoot, 'AssessmentWizard.tsx'), 'utf8');
    expect(wizard).toContain('kind="assets"');
    expect(wizard).toContain('kind="assessment-templates"');
  });
});
