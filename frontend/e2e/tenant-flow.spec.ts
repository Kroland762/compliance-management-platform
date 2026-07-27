import { expect, test } from '@playwright/test';

test('global administrator selects a tenant and completes core control flow', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(process.env.E2E_ADMIN_USERNAME || 'admin');
  await page.getByPlaceholder('密码').fill(process.env.E2E_ADMIN_PASSWORD || 'Admin1234!');
  await page.getByPlaceholder('验证码').fill('0000');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/tenants$/);
  const selector = page.getByRole('combobox', { name: '选择租户' });
  await selector.click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: 'E2E Tenant' })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const auth = await page.evaluate(() => (window as any).__authStore);
  expect(auth.selectedTenant?.id).toBeTruthy();
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    'X-Tenant-ID': auth.selectedTenant.id,
  };

  const suffix = Date.now();
  const roleResponse = await page.request.get('http://127.0.0.1:3001/api/roles', { headers });
  expect(roleResponse.ok()).toBeTruthy();
  const roles = (await roleResponse.json()).data.items;
  const userRole = roles.find((role: any) => role.name === '普通用户') || roles[0];

  const userResponse = await page.request.post('http://127.0.0.1:3001/api/users', {
    headers,
    data: {
      username: `e2e_user_${suffix}`,
      password: 'E2eUser1234!',
      roleId: userRole.id,
      department: '安全测试',
    },
  });
  expect(userResponse.status()).toBe(201);
  const userId = (await userResponse.json()).data.id;

  const qualificationName = `E2E资质-${suffix}`;
  const qualificationResponse = await page.request.post('http://127.0.0.1:3001/api/qualifications', {
    headers,
    data: { name: qualificationName, category: '企业资质', expiryDate: '2030-12-31' },
  });
  expect(qualificationResponse.status()).toBe(201);
  await page.goto('/qualifications');
  await expect(page.getByText(qualificationName)).toBeVisible();

  const templateResponse = await page.request.post('http://127.0.0.1:3001/api/templates/import', {
    headers,
    multipart: {
      name: `E2E模板-${suffix}`,
      description: 'Playwright core flow',
      file: {
        name: 'template.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('序号,控制域名,控制点,参考回答\n1,访问控制,账号复核,应定期复核\n'),
      },
    },
  });
  expect(templateResponse.status()).toBe(201);
  const templateId = (await templateResponse.json()).data.templateId;

  const taskResponse = await page.request.post('http://127.0.0.1:3001/api/tasks', {
    headers,
    data: {
      templateId,
      assessmentType: 'ISO27001',
      assessmentTarget: `E2E任务-${suffix}`,
    },
  });
  expect(taskResponse.status()).toBe(201);
  const taskId = (await taskResponse.json()).data.id;

  const questionsResponse = await page.request.get(`http://127.0.0.1:3001/api/tasks/${taskId}/questions`, { headers });
  expect(questionsResponse.ok()).toBeTruthy();
  const question = (await questionsResponse.json()).data.questions[0];

  const configureResponse = await page.request.put(`http://127.0.0.1:3001/api/tasks/${taskId}/configure`, {
    headers,
    data: {
      questionAssignments: [{
        questionId: question.id,
        assignedTo: userId,
        responsibleDepartment: '安全测试',
        responsiblePerson: `e2e_user_${suffix}`,
        referenceAnswer: '应定期复核',
      }],
    },
  });
  expect(configureResponse.ok()).toBeTruthy();

  const userLoginResponse = await page.request.post('http://127.0.0.1:3001/api/auth/login', {
    data: {
      username: `e2e_user_${suffix}`,
      password: 'E2eUser1234!',
      captchaCode: '0000',
    },
  });
  expect(userLoginResponse.ok()).toBeTruthy();
  const userToken = (await userLoginResponse.json()).data.token;
  const userHeaders = {
    Authorization: `Bearer ${userToken}`,
    'X-Tenant-ID': auth.selectedTenant.id,
  };

  const answerResponse = await page.request.put(`http://127.0.0.1:3001/api/questions/${question.id}/answer`, {
    headers: userHeaders,
    data: { currentStatusDescription: '已完成账号定期复核' },
  });
  expect(answerResponse.ok()).toBeTruthy();

  const evidenceResponse = await page.request.post(`http://127.0.0.1:3001/api/questions/${question.id}/evidence`, {
    headers: userHeaders,
    multipart: {
      file: {
        name: 'evidence.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nE2E evidence\n'),
      },
    },
  });
  expect(evidenceResponse.status()).toBe(201);
  const evidenceId = (await evidenceResponse.json()).data.id;

  const downloadResponse = await page.request.get(`http://127.0.0.1:3001/api/evidence/${evidenceId}/download`, {
    headers: userHeaders,
  });
  expect(downloadResponse.ok()).toBeTruthy();
  expect(downloadResponse.headers()['content-type']).toContain('application/pdf');

  const submitResponse = await page.request.post(`http://127.0.0.1:3001/api/tasks/${taskId}/submit`, {
    headers: userHeaders,
  });
  expect(submitResponse.ok()).toBeTruthy();
  expect((await submitResponse.json()).data.status).toBe('submitted');

  const reviewDataResponse = await page.request.get(`http://127.0.0.1:3001/api/review/tasks/${taskId}`, { headers });
  expect(reviewDataResponse.ok()).toBeTruthy();
  const reviewQuestion = (await reviewDataResponse.json()).data[0];
  expect(reviewQuestion.evidenceFiles[0].id).toBe(evidenceId);
  expect(reviewQuestion.evidenceFiles[0].storageKey).toBeUndefined();
  expect(reviewQuestion.evidenceFiles[0].filePath).toBeUndefined();

  const reviewResponse = await page.request.put(`http://127.0.0.1:3001/api/review/questions/${question.id}`, {
    headers,
    data: {
      complianceStatus: 'non_compliant',
      riskIdentification: `E2E风险-${suffix}`,
      riskLevel: 'high',
      remediationMeasures: '立即整改并复核',
    },
  });
  expect(reviewResponse.ok()).toBeTruthy();

  const completeReviewResponse = await page.request.post(
    `http://127.0.0.1:3001/api/tasks/${taskId}/complete-review`,
    { headers },
  );
  expect(completeReviewResponse.ok()).toBeTruthy();
  expect((await completeReviewResponse.json()).data.status).toBe('completed');

  const riskResponse = await page.request.get(
    `http://127.0.0.1:3001/api/risks?page=1&pageSize=20`,
    { headers },
  );
  expect(riskResponse.ok()).toBeTruthy();
  expect((await riskResponse.json()).data.items.some(
    (risk: any) => risk.riskIdentification === `E2E风险-${suffix}`,
  )).toBeTruthy();

  const accountCsvResponse = await page.request.get(
    'http://127.0.0.1:3001/api/account/problems/export/data?format=csv',
    { headers },
  );
  expect(accountCsvResponse.ok()).toBeTruthy();
  expect(accountCsvResponse.headers()['content-type']).toContain('text/csv');

  const auditResponse = await page.request.get(
    'http://127.0.0.1:3001/api/audit-logs?page=1&pageSize=100',
    { headers },
  );
  expect(auditResponse.ok()).toBeTruthy();
  const auditItems = (await auditResponse.json()).data.items;
  expect(auditItems.some((item: any) => item.resourceType === 'task' && item.resourceId === taskId)).toBeTruthy();
  expect(auditItems.some((item: any) => item.resourceType === 'evidence' && item.resourceId === evidenceId)).toBeTruthy();

  await page.goto('/users');
  await expect(page.getByText(`e2e_user_${suffix}`)).toBeVisible();
});
