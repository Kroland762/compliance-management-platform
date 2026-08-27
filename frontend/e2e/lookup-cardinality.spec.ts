import { expect, test, type APIResponse, type Page } from '@playwright/test';

async function inBatches<T>(items: T[], size: number, operation: (item: T) => Promise<APIResponse>) {
  for (let offset = 0; offset < items.length; offset += size) {
    const responses = await Promise.all(items.slice(offset, offset + size).map(operation));
    for (const response of responses) expect(response.status()).toBe(201);
  }
}

async function selectTenant(page: Page, tenantSlug: string) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(process.env.E2E_ADMIN_USERNAME || 'admin');
  await page.getByPlaceholder('密码').fill(process.env.E2E_ADMIN_PASSWORD || 'Admin1234');
  await page.getByPlaceholder('验证码').fill('0000');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/tenants$/);
  await page.getByRole('row', { name: new RegExp(tenantSlug) }).getByRole('button', { name: '查看用户' }).click();
  await expect(page).toHaveURL(/\/users$/);
}

async function tenantApiAuth(page: Page, tenantSlug: string) {
  const loginResponse = await page.request.post('http://127.0.0.1:3001/api/auth/login', {
    data: {
      username: process.env.E2E_ADMIN_USERNAME || 'admin',
      password: process.env.E2E_ADMIN_PASSWORD || 'Admin1234',
      captchaCode: '0000',
    },
  });
  expect(loginResponse.ok()).toBeTruthy();
  let payload = (await loginResponse.json()).data;
  let token = payload.token;
  let selectedTenant = (payload.contexts || []).find((item: any) => item.slug === tenantSlug)
    || (payload.user?.tenantId ? (payload.contexts || []).find((item: any) => item.id === payload.user.tenantId) : null);
  expect(selectedTenant?.id).toBeTruthy();
  if (payload.user?.tenantId !== selectedTenant.id) {
    const contextResponse = await page.request.post('http://127.0.0.1:3001/api/auth/context', {
      headers: { Authorization: `Bearer ${token}` },
      data: { tenantId: selectedTenant.id },
    });
    expect(contextResponse.ok()).toBeTruthy();
    payload = (await contextResponse.json()).data;
    token = payload.token;
    selectedTenant = (payload.contexts || []).find((item: any) => item.id === payload.user?.tenantId) || selectedTenant;
  }
  return { token, selectedTenant };
}

test('human-readable lookups find records beyond the former first-page limits', async ({ page }) => {
  test.setTimeout(240_000);
  const tenantSlug = process.env.E2E_MUTATION_TENANT_SLUG;
  test.skip(!tenantSlug, 'Set E2E_MUTATION_TENANT_SLUG to an isolated disposable tenant.');
  await selectTenant(page, tenantSlug!);

  const auth = await tenantApiAuth(page, tenantSlug!);
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    'X-Tenant-ID': auth.selectedTenant.id,
  };
  const suffix = Date.now();
  const rolesResponse = await page.request.get('http://127.0.0.1:3001/api/roles?pageSize=50', { headers });
  expect(rolesResponse.ok()).toBeTruthy();
  const roles = (await rolesResponse.json()).data.items;
  const memberRole = roles.find((role: any) => role.name === '普通用户') || roles[0];
  const rootResponse = await page.request.get(
    'http://127.0.0.1:3001/api/lookup/options/departments?purpose=user-membership&pageSize=50',
    { headers },
  );
  expect(rootResponse.ok()).toBeTruthy();
  const rootDepartment = (await rootResponse.json()).data.items[0];
  expect(rootDepartment).toBeTruthy();

  const departmentNames = Array.from({ length: 105 }, (_, index) =>
    `高基数部门${String(index + 1).padStart(3, '0')}-${suffix}`);
  await inBatches(departmentNames, 12, (name) => page.request.post('http://127.0.0.1:3001/api/departments', {
    headers,
    data: {
      name,
      code: `HC_${suffix}_${departmentNames.indexOf(name) + 1}`,
      parentId: rootDepartment.value,
      sortOrder: departmentNames.indexOf(name) + 1,
    },
  }));

  const personnelNames = Array.from({ length: 105 }, (_, index) =>
    `高基数人员${String(index + 1).padStart(3, '0')}-${suffix}`);
  await inBatches(personnelNames, 6, (displayName) => {
    const index = personnelNames.indexOf(displayName) + 1;
    return page.request.post('http://127.0.0.1:3001/api/members', {
      headers,
      data: {
        username: `hc_${suffix}_${index}`,
        displayName,
        roleIds: [memberRole.id],
        departments: [{ departmentId: rootDepartment.value, isPrimary: true }],
      },
    });
  });

  const dataSourceNames = Array.from({ length: 25 }, (_, index) =>
    `高基数数据源${String(index + 1).padStart(2, '0')}-${suffix}`);
  await inBatches(dataSourceNames, 8, (name) => page.request.post('http://127.0.0.1:3001/api/account/data-sources', {
    headers,
    data: {
      name,
      sourceType: 'DATABASE',
      connectionConfig: {
        dbType: 'postgres', host: '8.8.8.8', port: 5432, database: 'audit', username: 'readonly',
        schema: 'public', table: 'accounts', allowedColumns: ['username'], ssl: true,
      },
      fieldMappingConfig: { username: 'username' },
    },
  }));

  const ruleNames = Array.from({ length: 25 }, (_, index) =>
    `高基数规则${String(index + 1).padStart(2, '0')}-${suffix}`);
  await inBatches(ruleNames, 10, (name) => page.request.post('http://127.0.0.1:3001/api/account/rules', {
    headers,
    data: { name, severity: 'LOW', conditionLogic: { operator: 'AND', conditions: [] } },
  }));

  const lookup = async (kind: string, purpose: string, q: string) => {
    const response = await page.request.get(
      `http://127.0.0.1:3001/api/lookup/options/${kind}?purpose=${purpose}&q=${encodeURIComponent(q)}&page=1&pageSize=20`,
      { headers },
    );
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data;
  };

  const targetDepartment = departmentNames[100];
  const targetPersonnel = personnelNames[100];
  const targetDataSource = dataSourceNames[20];
  const targetRule = ruleNames[20];
  const departmentResult = await lookup('departments', 'asset-owner', targetDepartment);
  expect(departmentResult.items.some((item: any) => item.label.includes(targetDepartment))).toBeTruthy();
  expect(JSON.stringify(departmentResult)).not.toContain(`HC_${suffix}_101`);
  expect((await lookup('departments', 'asset-owner', `HC_${suffix}_101`)).items).toHaveLength(0);
  const personnelResult = await lookup('personnel', 'asset-owner', targetPersonnel);
  const personnelOption = personnelResult.items.find((item: any) => item.label === targetPersonnel);
  expect(personnelOption).toBeTruthy();
  expect((await lookup('personnel', 'asset-owner', personnelOption.value)).items).toHaveLength(0);
  const dataSourceResult = await lookup('account-data-sources', 'account-task-source', targetDataSource);
  const dataSourceOption = dataSourceResult.items.find((item: any) => item.label === targetDataSource);
  expect(dataSourceOption).toBeTruthy();
  expect(Object.keys(dataSourceOption.meta || {}).sort()).toEqual(['sourceType', 'status']);
  expect((await lookup('account-rules', 'account-task-rules', targetRule)).items.some((item: any) => item.label === targetRule)).toBeTruthy();

  await page.goto('/assets');
  await page.getByRole('button', { name: '新增资产' }).click();
  const assetDialog = page.getByRole('dialog', { name: '新增资产' });
  const departmentSelect = assetDialog.getByRole('combobox', { name: '责任部门' });
  await departmentSelect.click();
  const [departmentSearch] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/lookup/options/departments') && response.url().includes('q=')),
    departmentSelect.fill(targetDepartment),
  ]);
  expect(departmentSearch.ok()).toBeTruthy();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: targetDepartment }).click();
  const personnelSelect = assetDialog.getByRole('combobox', { name: '负责人' });
  await personnelSelect.click();
  const [personnelSearch] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/lookup/options/personnel') && response.url().includes('q=')),
    personnelSelect.fill(targetPersonnel),
  ]);
  expect(personnelSearch.ok()).toBeTruthy();
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: targetPersonnel })).toBeVisible();
  await assetDialog.getByRole('button', { name: 'Close' }).click();

  await page.goto('/account-audit/tasks');
  await page.getByRole('button', { name: /创建任务/ }).click();
  const taskDialog = page.getByRole('dialog', { name: '创建任务' });
  let remoteSelect = taskDialog.locator('.ant-select').first();
  await remoteSelect.locator('.ant-select-selector').click();
  let searchInput = remoteSelect.locator('input[role="combobox"]');
  const [sourceSearch] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/lookup/options/account-data-sources') && response.url().includes('q=')),
    searchInput.fill(targetDataSource),
  ]);
  expect(sourceSearch.ok()).toBeTruthy();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: targetDataSource }).click();
  await taskDialog.getByRole('button', { name: '下一步' }).click();
  remoteSelect = taskDialog.locator('.ant-select').first();
  await remoteSelect.locator('.ant-select-selector').click();
  searchInput = remoteSelect.locator('input[role="combobox"]');
  const [ruleSearch] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/lookup/options/account-rules') && response.url().includes('q=')),
    searchInput.fill(targetRule),
  ]);
  expect(ruleSearch.ok()).toBeTruthy();
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: targetRule })).toBeVisible();
});
