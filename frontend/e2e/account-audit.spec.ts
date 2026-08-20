import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: any, username: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByPlaceholder('验证码').fill('0000');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login$/);

  if (/\/tenants$/.test(page.url())) {
    const targetTenant = process.env.E2E_MUTATION_TENANT_SLUG;
    const rowName = targetTenant
      ? new RegExp(targetTenant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : /默认租户/;
    await page.getByRole('row', { name: rowName }).getByRole('button', { name: '查看用户' }).click();
  } else if (/\/tenant-select$/.test(page.url())) {
    await page.getByRole('button', { name: '进入' }).first().click();
  }

  await expect(page).not.toHaveURL(/\/(login|tenant-select|tenants)$/);
}

test('administrator can navigate account audit, filter, export and configure schedules', async ({ page }) => {
  await login(page, process.env.E2E_ADMIN_USERNAME || 'admin', process.env.E2E_ADMIN_PASSWORD || 'Admin1234');
  await page.goto('/account-audit');
  await expect(page).toHaveURL(/\/account-audit\/dashboard$/);
  await expect(page.getByText('账户审计')).toBeVisible();

  await page.goto('/account-audit/problems');
  await page.getByPlaceholder('搜索账户或描述').fill('nonexistent-account');
  const [listResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/account/problems?')),
    page.getByRole('button', { name: /查\s*询/ }).click(),
  ]);
  expect(listResponse.ok()).toBeTruthy();
  const [exportResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/account/problems/export/data')),
    page.getByRole('button', { name: /导出/ }).click(),
  ]);
  expect(exportResponse.headers()['content-type']).toContain('text/csv');

  await page.goto('/account-audit/tasks');
  await page.getByRole('button', { name: /创建任务/ }).click();
  const taskDialog = page.getByRole('dialog', { name: '创建任务' });
  await expect(taskDialog).toBeVisible();
  await taskDialog.getByRole('button', { name: /取\s*消/ }).click();
});

test('CSV system reuses its saved mapping and blocks incompatible replacement files', async ({ page }) => {
  await login(page, process.env.E2E_ADMIN_USERNAME || 'admin', process.env.E2E_ADMIN_PASSWORD || 'Admin1234');
  const sourceName = `E2E CSV ${Date.now()}`;

  await page.goto('/account-audit/data-sources/new');
  await page.getByLabel('数据源名称').fill(sourceName);
  await page.getByLabel('数据源类型').click();
  await page.getByRole('option', { name: 'CSV 文件' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'accounts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('uid,name,status\n1,Alice,active\n2,Bob,disabled'),
  });
  await expect(page.getByText(/检测到 2 行/)).toBeVisible();

  await page.getByTestId('mapping-accountId').click();
  await page.getByRole('option', { name: 'uid', exact: true }).click();
  await page.getByTestId('mapping-accountName').click();
  await page.getByRole('option', { name: 'name', exact: true }).click();
  await page.getByTestId('mapping-accountStatus').click();
  await page.getByRole('option', { name: 'status', exact: true }).click();
  await page.getByRole('button', { name: '创建数据源' }).click();
  const createDialog = page.getByRole('dialog', { name: /确认创建 CSV 数据源并导入/ });
  await createDialog.getByRole('button', { name: '确认导入' }).click();
  await expect(page).toHaveURL(/\/account-audit\/data-sources$/);
  await expect(page.getByText(sourceName)).toBeVisible();

  await page.getByText(sourceName).click();
  await page.getByRole('button', { name: /重新上传/ }).click();
  let uploadDialog = page.getByRole('dialog', { name: new RegExp(`重新上传 CSV.*${sourceName}`) });
  await uploadDialog.locator('input[type="file"]').setInputFiles({
    name: 'accounts-v2.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('uid,name,status\n1,Alice,active\n3,Carol,active'),
  });
  await expect(uploadDialog.getByText('映射兼容')).toBeVisible();
  await uploadDialog.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByText(/导入完成，共 2 条/)).toBeVisible();

  await page.getByRole('button', { name: /重新上传/ }).click();
  uploadDialog = page.getByRole('dialog', { name: new RegExp(`重新上传 CSV.*${sourceName}`) });
  await uploadDialog.locator('input[type="file"]').setInputFiles({
    name: 'accounts-incompatible.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('new_uid,name,status\n9,Mallory,active'),
  });
  await expect(uploadDialog.getByText(/缺少原字段：uid/)).toBeVisible();
  await expect(uploadDialog.getByRole('button', { name: '确认导入' })).toBeDisabled();
  await uploadDialog.locator('.ant-modal-close').click();
});

test('auditor has the restricted account audit view', async ({ page }) => {
  test.skip(!process.env.E2E_AUDITOR_PASSWORD, 'Set E2E_AUDITOR_PASSWORD to run role-specific account-audit regression safely.');
  await login(page, process.env.E2E_AUDITOR_USERNAME || 'auditor', process.env.E2E_AUDITOR_PASSWORD!);
  await page.goto('/account-audit/data-sources');
  await expect(page.getByRole('button', { name: '添加数据源' })).toHaveCount(0);
  await page.goto('/account-audit/tasks');
  await expect(page.getByRole('button', { name: /创建任务/ })).toHaveCount(0);
  await page.goto('/account-audit/problems');
  await expect(page.getByRole('button', { name: '导出' })).toBeVisible();
});
