import { expect, request, test, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3001';
const appBase = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';

test.use({ actionTimeout: 15_000 });

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByPlaceholder('验证码').fill('0000');
  await page.locator('button[type="submit"]').click();
}

async function selectLookup(page: Page, label: string, query: string, option: string) {
  const combobox = page.getByRole('combobox', { name: label });
  await combobox.scrollIntoViewIfNeeded();
  await combobox.locator('xpath=ancestor::div[contains(@class, "ant-select-selector")]').click();
  await combobox.fill(query);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: option }).first().click();
}

async function adminTenantAuth(page: Page, tenantSlug: string) {
  const response = await page.request.post(`${apiBase}/api/auth/login`, {
    data: {
      username: process.env.E2E_ADMIN_USERNAME || 'admin',
      password: process.env.E2E_ADMIN_PASSWORD || 'Admin1234',
      captchaCode: '0000',
    },
  });
  expect(response.ok()).toBeTruthy();
  let payload = (await response.json()).data;
  const tenant = payload.contexts.find((item: any) => item.slug === tenantSlug);
  expect(tenant?.id).toBeTruthy();
  const context = await page.request.post(`${apiBase}/api/auth/context`, {
    headers: { Authorization: `Bearer ${payload.token}` },
    data: { tenantId: tenant.id },
  });
  expect(context.ok()).toBeTruthy();
  payload = (await context.json()).data;
  return {
    tenant,
    headers: { Authorization: `Bearer ${payload.token}`, 'X-Tenant-ID': tenant.id },
  };
}

test('独立风险从日常运维发现到整改验证和关闭的真实 UI 闭环', async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  const tenantSlug = process.env.E2E_MUTATION_TENANT_SLUG;
  const auditorUsername = process.env.E2E_AUDITOR_USERNAME;
  const auditorPassword = process.env.E2E_AUDITOR_PASSWORD;
  test.skip(!tenantSlug || !auditorUsername || !auditorPassword,
    '需要隔离租户及审核人凭据；该用例会创建风险、资产、成员和整改数据。');

  const auth = await adminTenantAuth(page, tenantSlug!);
  const suffix = Date.now();
  const ownerUsername = `e2e_risk_owner_${suffix}`;
  const ownerPassword = 'E2eRiskOwner1234!';
  const ownerName = `E2E 风险负责人 ${suffix}`;
  const riskTitle = `E2E 日常运维风险 ${suffix}`;
  const actionTitle = `E2E 独立风险整改 ${suffix}`;
  const pageErrors: string[] = [];
  const diagnosticMessages: string[] = [];
  const observeErrors = (target: Page) => {
    target.on('pageerror', (error) => pageErrors.push(error.message));
    target.on('console', (event) => {
      if (event.type() !== 'error') return;
      const text = event.text();
      if (text.startsWith('Warning:') || text.startsWith('Failed to load resource:')) diagnosticMessages.push(text);
      else pageErrors.push(text);
    });
    target.on('response', (response) => {
      if (response.status() < 400) return;
      const path = new URL(response.url()).pathname;
      // Anonymous refresh and tenant-free session settings are existing shell behavior.
      if ((path === '/api/auth/refresh' && response.status() === 401)
        || (path === '/api/settings/session' && response.status() === 403)) return;
      pageErrors.push(`${response.status()} ${response.request().method()} ${path}`);
    });
  };
  observeErrors(page);

  const [roleResponse, departmentsResponse] = await Promise.all([
    page.request.get(`${apiBase}/api/roles`, { headers: auth.headers }),
    page.request.get(`${apiBase}/api/lookup/options/departments?purpose=user-membership&pageSize=50`, { headers: auth.headers }),
  ]);
  expect(roleResponse.ok()).toBeTruthy();
  expect(departmentsResponse.ok()).toBeTruthy();
  const roles = (await roleResponse.json()).data.items;
  const memberRole = roles.find((role: any) => role.name === '普通用户');
  const department = (await departmentsResponse.json()).data.items[0];
  expect(memberRole?.id).toBeTruthy();
  expect(department?.value).toBeTruthy();

  const memberResponse = await page.request.post(`${apiBase}/api/members`, {
    headers: auth.headers,
    data: {
      username: ownerUsername,
      displayName: ownerName,
      email: `${ownerUsername}@example.com`,
      roleIds: [memberRole.id],
      departments: [{ departmentId: department.value, isPrimary: true }],
    },
  });
  expect(memberResponse.status()).toBe(201);
  const memberData = (await memberResponse.json()).data;
  const ownerUserId = memberData.member.userId;
  const ownerApi = await request.newContext({ baseURL: apiBase });
  const firstLogin = await ownerApi.post('/api/auth/login', {
    data: { username: ownerUsername, password: memberData.temporaryPassword, captchaCode: '0000' },
  });
  expect(firstLogin.ok()).toBeTruthy();
  const temporaryToken = (await firstLogin.json()).data.token;
  expect((await ownerApi.post('/api/auth/change-password', {
    headers: { Authorization: `Bearer ${temporaryToken}` },
    data: { oldPassword: memberData.temporaryPassword, newPassword: ownerPassword },
  })).ok()).toBeTruthy();
  await ownerApi.dispose();

  const assetName = `E2E 运维资产 ${suffix}`;
  const assetResponse = await page.request.post(`${apiBase}/api/assets`, {
    headers: auth.headers,
    data: {
      code: `E2E-RISK-${suffix}`,
      name: assetName,
      assetType: 'application',
      criticality: 'high',
      ownerDepartmentId: department.value,
      ownerUserId,
    },
  });
  expect(assetResponse.status()).toBe(201);

  await login(page, process.env.E2E_ADMIN_USERNAME || 'admin', process.env.E2E_ADMIN_PASSWORD || 'Admin1234');
  await expect(page).toHaveURL(/\/tenants$/);
  await page.getByRole('row', { name: new RegExp(tenantSlug!) }).getByRole('button', { name: '查看用户' }).click();
  await expect(page).toHaveURL(/\/users$/);
  await page.goto('/governance');
  await expect(page.getByRole('heading', { name: '风险与整改' })).toBeVisible();
  await page.getByRole('button', { name: '新增风险' }).click();
  await expect(page).toHaveURL(/\/risks\/new$/);
  await page.getByLabel('标题').fill(riskTitle);
  await page.getByLabel('描述').fill('日常巡检发现运维账号长期未复核，需要完成整改闭环。');
  await expect(page.locator('.ant-select-selection-item[title="日常运维"]')).toBeVisible();
  await page.getByLabel('来源说明').fill('运维值班人员在月度账号巡检中发现异常。');
  await page.getByLabel('来源引用').fill(`OPS-${suffix}`);
  await selectLookup(page, '责任部门', department.label, department.label);
  await selectLookup(page, '负责人', ownerName, ownerName);
  await selectLookup(page, '审核人', 'CI Auditor', 'CI Auditor');
  const assetLookup = page.getByRole('combobox', { name: '受影响资产' });
  await assetLookup.click();
  await assetLookup.fill(assetName);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: assetName }).click();
  await page.getByRole('button', { name: '创建风险' }).click();
  await expect(page).toHaveURL(/\/risks\/[0-9a-f-]+$/);
  const riskId = page.url().split('/').pop()!;
  await expect(page.getByText(riskTitle)).toBeVisible();
  await expect(page.getByText('日常运维', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible();
  await expect(page.getByText('CI Auditor', { exact: true })).toBeVisible();

  // Create a reviewer with risks.verify but without remediation_actions.verify.
  // This exercises the same role/permission contract as the verification API.
  const reviewerPermissions = {
    risks: ['read', 'confirm', 'verify', 'close'], remediation_actions: ['read'],
    dashboard: ['read'], notifications: ['read', 'update'],
  };
  const reviewerRoleResponse = await page.request.post(`${apiBase}/api/roles`, {
    headers: auth.headers,
    data: {
      name: `E2E risk reviewer ${suffix}`, permissions: reviewerPermissions,
      permissionScopes: Object.fromEntries(Object.entries(reviewerPermissions).map(([resource, actions]) =>
        [resource, Object.fromEntries(actions.map((permission) => [permission, 'assigned']))])),
    },
  });
  expect(reviewerRoleResponse.status()).toBe(201);
  const reviewerRoleId = (await reviewerRoleResponse.json()).data.id;
  const reviewerName = `E2E 独立审核人 ${suffix}`;
  const reviewerUsername = `e2e_risk_reviewer_${suffix}`;
  const reviewerPassword = 'E2eRiskReviewer1234!';
  const reviewerResponse = await page.request.post(`${apiBase}/api/members`, {
    headers: auth.headers,
    data: { username: reviewerUsername, displayName: reviewerName, roleIds: [reviewerRoleId],
      departments: [{ departmentId: department.value, isPrimary: true }] },
  });
  expect(reviewerResponse.status()).toBe(201);
  const reviewerData = (await reviewerResponse.json()).data;
  const reviewerApi = await request.newContext({ baseURL: apiBase });
  const reviewerFirstLogin = await reviewerApi.post('/api/auth/login', {
    data: { username: reviewerUsername, password: reviewerData.temporaryPassword, captchaCode: '0000' },
  });
  expect(reviewerFirstLogin.ok()).toBeTruthy();
  const reviewerTemporaryToken = (await reviewerFirstLogin.json()).data.token;
  expect((await reviewerApi.post('/api/auth/change-password', {
    headers: { Authorization: `Bearer ${reviewerTemporaryToken}` },
    data: { oldPassword: reviewerData.temporaryPassword, newPassword: reviewerPassword },
  })).ok()).toBeTruthy();
  await reviewerApi.dispose();

  await page.getByRole('button', { name: /^编\s*辑$/ }).click();
  await expect(page.getByRole('heading', { name: '编辑风险' })).toBeVisible();
  const editedDescription = '已补充运维排查范围，审核人与风险资料分开保存。';
  await page.getByLabel('描述', { exact: true }).fill(editedDescription);
  await selectLookup(page, '审核人', reviewerName, reviewerName);
  const assignResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/risks/${riskId}/reviewer`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '分配审核人', exact: true }).click();
  const assignResponse = await assignResponsePromise;
  expect(assignResponse.ok(), await assignResponse.text()).toBeTruthy();
  const assignedRisk = (await assignResponse.json()).data;
  expect(assignedRisk.reviewerUserId).toBe(reviewerData.member.userId);
  expect(assignedRisk.description).not.toBe(editedDescription);
  await expect(page.getByLabel('描述', { exact: true })).toHaveValue(editedDescription);
  await page.getByRole('heading', { name: '编辑风险' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('independent-reviewer.png'), fullPage: true });
  const editResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/risks/${riskId}`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const editResponse = await editResponsePromise;
  expect(editResponse.ok(), await editResponse.text()).toBeTruthy();
  expect(editResponse.request().headers()['if-match']).toBe(`"${assignedRisk.lockVersion}"`);
  await expect(page).toHaveURL(new RegExp(`/risks/${riskId}$`));
  await expect(page.getByText(editedDescription, { exact: true })).toBeVisible();

  const projectFiltered = await page.request.get(`${apiBase}/api/risks`, {
    headers: auth.headers,
    params: { taskId: '00000000-0000-4000-8000-000000000001', pageSize: 100 },
  });
  expect(projectFiltered.ok()).toBeTruthy();
  expect((await projectFiltered.json()).data.items.some((item: any) => item.id === riskId)).toBeFalsy();

  const auditorContext = await browser.newContext({ baseURL: appBase });
  const auditorPage = await auditorContext.newPage();
  observeErrors(auditorPage);
  await login(auditorPage, reviewerUsername, reviewerPassword);
  await expect(auditorPage).toHaveURL(/\/dashboard$/);
  await auditorPage.goto('/work-items');
  await expect(auditorPage.getByRole('tab', { name: /^待确认风险 \d+$/ })).toBeVisible();
  const confirmRow = auditorPage.getByRole('row', { name: new RegExp(riskTitle) });
  await confirmRow.getByRole('button', { name: '去确认' }).click();
  await auditorPage.getByRole('button', { name: '确认风险' }).click();
  await expect(auditorPage.getByText('已识别', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '创建整改行动' }).click();
  const actionDialog = page.getByRole('dialog', { name: '创建整改行动' });
  await expect(actionDialog).toBeVisible();
  await actionDialog.getByLabel('行动标题').fill(actionTitle);
  await actionDialog.getByLabel('执行说明').fill('完成账号清理、权限复核并保留验证记录。');
  await actionDialog.getByLabel('对关联风险的整改贡献').fill('移除冗余权限并建立定期复核机制。');
  await selectLookup(page, '责任部门', department.label, department.label);
  await selectLookup(page, '负责人', ownerName, ownerName);
  await actionDialog.getByLabel('完成期限').fill('2030-12-31');
  await actionDialog.getByLabel('完成期限').press('Enter');
  const actionCreatePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/remediation-actions') && response.request().method() === 'POST', { timeout: 15_000 });
  await actionDialog.getByRole('button', { name: 'OK' }).click();
  const actionCreateResponse = await actionCreatePromise;
  expect(actionCreateResponse.status(), await actionCreateResponse.text()).toBe(201);
  await expect(page).toHaveURL(/\/remediation-actions\/[0-9a-f-]+$/);
  const actionId = page.url().split('/').pop()!;
  await expect(page.getByText(actionTitle)).toBeVisible();

  const ownerContext = await browser.newContext({ baseURL: appBase });
  const ownerPage = await ownerContext.newPage();
  observeErrors(ownerPage);
  await login(ownerPage, ownerUsername, ownerPassword);
  await expect(ownerPage).toHaveURL(/\/dashboard$/);
  await ownerPage.goto(`/remediation-actions/${actionId}`);
  await ownerPage.getByRole('button', { name: '填写进展' }).click();
  const progressDialog = ownerPage.getByRole('dialog', { name: '填写整改进展' });
  await progressDialog.getByLabel('进展说明').fill('已清理冗余账号并完成权限复核。');
  await progressDialog.locator('button.ant-btn-primary').click();
  await ownerPage.locator('input[type="file"]').setInputFiles({
    name: 'remediation-evidence.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nIndependent risk remediation evidence\n'),
  });
  await expect(ownerPage.getByText('remediation-evidence.pdf')).toBeVisible();
  await ownerPage.getByRole('button', { name: '提交复核' }).click();
  await expect(ownerPage.getByText('待验证', { exact: true }).first()).toBeVisible();

  await auditorPage.goto('/work-items');
  await expect(auditorPage.getByRole('heading', { name: '我的待办' })).toBeVisible();
  await auditorPage.getByRole('tab', { name: /^待验证 \d+$/ }).click();
  await auditorPage.getByRole('row', { name: new RegExp(actionTitle) }).getByRole('button', { name: '去验证' }).click();
  await expect(auditorPage).toHaveURL(new RegExp(`/remediation-actions/${actionId}$`));
  await auditorPage.getByRole('button', { name: /^验\s*证$/ }).click();
  const verificationDialog = auditorPage.getByRole('dialog', { name: '整改验证' });
  await verificationDialog.getByPlaceholder('复核意见').fill('整改证据和结果符合关闭要求。');
  await verificationDialog.locator('.ant-modal-footer button.ant-btn-primary').click();
  await expect(auditorPage.getByText('已完成', { exact: true }).first()).toBeVisible();
  await auditorPage.goto(`/risks/${riskId}`);
  await auditorPage.getByRole('button', { name: '关闭风险' }).click();
  const closeDialog = auditorPage.getByRole('dialog', { name: '关闭风险' });
  await closeDialog.getByLabel('关闭说明').fill('必要整改行动已由独立审核人验证通过。');
  await closeDialog.locator('button.ant-btn-primary').click();
  await expect(auditorPage.getByText('已关闭', { exact: true }).first()).toBeVisible();
  await expect(closeDialog).not.toBeVisible();
  await auditorPage.screenshot({ path: testInfo.outputPath('risk-closed.png'), fullPage: true });
  await testInfo.attach('console-diagnostics', { body: diagnosticMessages.join('\n'), contentType: 'text/plain' });
  expect(pageErrors).toEqual([]);

  await ownerContext.close();
  await auditorContext.close();
});
