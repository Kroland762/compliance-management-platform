import { expect, test } from '@playwright/test';

test('global administrator selects a tenant and completes core control flow', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(process.env.E2E_ADMIN_USERNAME || 'admin');
  await page.getByPlaceholder('密码').fill(process.env.E2E_ADMIN_PASSWORD || 'Admin1234!');
  await page.getByPlaceholder('验证码').fill('0000');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/tenants$/);
  await page.getByRole('row', { name: /CI Tenant/ }).getByRole('button', { name: '查看用户' }).click();
  await expect(page).toHaveURL(/\/users$/);

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
  const departmentsResponse = await page.request.get('http://127.0.0.1:3001/api/lookup/departments', { headers });
  expect(departmentsResponse.ok()).toBeTruthy();
  const rootDepartment = (await departmentsResponse.json()).data.find((department: any) => department.code === 'ROOT');

  const userResponse = await page.request.post('http://127.0.0.1:3001/api/members', {
    headers,
    data: {
      username: `e2e_user_${suffix}`,
      displayName: `E2E User ${suffix}`,
      email: `e2e-${suffix}@example.com`,
      roleIds: [userRole.id],
      departments: [{ departmentId: rootDepartment.id, isPrimary: true }],
    },
  });
  expect(userResponse.status()).toBe(201);
  const memberPayload = (await userResponse.json()).data;
  const userId = memberPayload.member.userId;
  const temporaryPassword = memberPayload.temporaryPassword;

  const qualificationName = `E2E资质-${suffix}`;
  const qualificationResponse = await page.request.post('http://127.0.0.1:3001/api/qualifications', {
    headers,
    data: {
      name: qualificationName,
      category: '企业资质',
      ownerDepartmentId: rootDepartment.id,
      expiryDate: '2030-12-31',
    },
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
      departmentId: rootDepartment.id,
    },
  });
  expect(taskResponse.status()).toBe(201);
  const taskId = (await taskResponse.json()).data.id;

  const assetResponse = await page.request.post('http://127.0.0.1:3001/api/assets', {
    headers,
    data: {
      code: `E2E-ASSET-${suffix}`,
      name: `E2E核心资产-${suffix}`,
      assetType: 'application',
      criticality: 'high',
      ownerDepartmentId: rootDepartment.id,
      ownerUserId: userId,
    },
  });
  expect(assetResponse.status()).toBe(201);
  const assetId = (await assetResponse.json()).data.id;
  const templateDetailResponse = await page.request.get(
    `http://127.0.0.1:3001/api/templates/${templateId}`,
    { headers },
  );
  const controlPointId = (await templateDetailResponse.json()).data.templateQuestions[0].id;
  expect((await page.request.put(`http://127.0.0.1:3001/api/tasks/${taskId}/assets`, {
    headers,
    data: { assetIds: [assetId] },
  })).ok()).toBeTruthy();
  expect((await page.request.put(`http://127.0.0.1:3001/api/tasks/${taskId}/control-asset-matrix`, {
    headers,
    data: {
      items: [{
        controlPointId,
        assetId,
        assignedTo: userId,
        responsibleDepartmentId: rootDepartment.id,
      }],
    },
  })).ok()).toBeTruthy();
  const publishResponse = await page.request.post(
    `http://127.0.0.1:3001/api/tasks/${taskId}/publish`,
    { headers },
  );
  expect(publishResponse.ok()).toBeTruthy();
  expect((await publishResponse.json()).data.total).toBe(1);
  const evaluationsResponse = await page.request.get(
    `http://127.0.0.1:3001/api/tasks/${taskId}/evaluations?pageSize=100`,
    { headers },
  );
  const evaluation = (await evaluationsResponse.json()).data.items[0];

  const userLoginResponse = await page.request.post('http://127.0.0.1:3001/api/auth/login', {
    data: {
      username: `e2e_user_${suffix}`,
      password: temporaryPassword,
      captchaCode: '0000',
    },
  });
  expect(userLoginResponse.ok()).toBeTruthy();
  const temporaryToken = (await userLoginResponse.json()).data.token;
  const changePasswordResponse = await page.request.post('http://127.0.0.1:3001/api/auth/change-password', {
    headers: { Authorization: `Bearer ${temporaryToken}` },
    data: { oldPassword: temporaryPassword, newPassword: 'E2eUserChanged1234!' },
  });
  expect(changePasswordResponse.ok()).toBeTruthy();
  const changedLoginResponse = await page.request.post('http://127.0.0.1:3001/api/auth/login', {
    data: {
      username: `e2e_user_${suffix}`,
      password: 'E2eUserChanged1234!',
      captchaCode: '0000',
    },
  });
  expect(changedLoginResponse.ok()).toBeTruthy();
  const userToken = (await changedLoginResponse.json()).data.token;
  const userHeaders = {
    Authorization: `Bearer ${userToken}`,
    'X-Tenant-ID': auth.selectedTenant.id,
  };

  const answerResponse = await page.request.put(`http://127.0.0.1:3001/api/evaluations/${evaluation.id}/answer`, {
    headers: userHeaders,
    data: { currentStatusDescription: '已完成账号定期复核', lockVersion: evaluation.lockVersion },
  });
  expect(answerResponse.ok()).toBeTruthy();

  const evidenceResponse = await page.request.post(`http://127.0.0.1:3001/api/evaluations/${evaluation.id}/evidence`, {
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

  const submitResponse = await page.request.post(`http://127.0.0.1:3001/api/evaluations/${evaluation.id}/submit`, {
    headers: userHeaders,
  });
  expect(submitResponse.ok()).toBeTruthy();
  expect((await submitResponse.json()).data.workflowStatus).toBe('submitted');

  const reviewDataResponse = await page.request.get(`http://127.0.0.1:3001/api/review/tasks/${taskId}`, { headers });
  expect(reviewDataResponse.ok()).toBeTruthy();
  const reviewEvaluation = (await reviewDataResponse.json()).data[0];
  expect(reviewEvaluation.evidenceFiles[0].id).toBe(evidenceId);
  expect(reviewEvaluation.evidenceFiles[0].storageKey).toBeUndefined();
  expect(reviewEvaluation.evidenceFiles[0].filePath).toBeUndefined();

  const reviewResponse = await page.request.post(`http://127.0.0.1:3001/api/evaluations/${evaluation.id}/review`, {
    headers,
    data: { complianceStatus: 'non_compliant' },
  });
  expect(reviewResponse.ok()).toBeTruthy();

  const completeReviewResponse = await page.request.post(
    `http://127.0.0.1:3001/api/tasks/${taskId}/complete-review`,
    { headers },
  );
  expect(completeReviewResponse.ok()).toBeTruthy();
  expect((await completeReviewResponse.json()).data.status).toBe('completed');

  const createRiskResponse = await page.request.post('http://127.0.0.1:3001/api/risks', {
    headers,
    data: {
      taskId,
      title: `E2E风险-${suffix}`,
      description: '账号复核控制项发现高风险',
      riskLevel: 'high',
      treatmentStrategy: 'mitigate',
      ownerDepartmentId: rootDepartment.id,
      ownerUserId: userId,
      sources: [{ controlEvaluationId: evaluation.id }],
      assets: [{ assetId }],
    },
  });
  expect(createRiskResponse.status()).toBe(201);
  const risk = (await createRiskResponse.json()).data;
  expect(risk.sources).toHaveLength(1);
  expect(risk.affectedAssets).toHaveLength(1);
  expect((await page.request.post(`http://127.0.0.1:3001/api/risks/${risk.id}/confirm`, { headers })).ok()).toBeTruthy();

  for (const actionIndex of [1, 2]) {
    const createActionResponse = await page.request.post('http://127.0.0.1:3001/api/remediation-actions', {
      headers,
      data: {
        title: `E2E整改行动${actionIndex}-${suffix}`,
        description: `完成第${actionIndex}项整改`,
        ownerUserId: userId,
        ownerDepartmentId: rootDepartment.id,
        dueDate: '2030-12-31',
        riskLinks: [{
          riskId: risk.id,
          isRequired: true,
          contributionDescription: `降低风险的第${actionIndex}项行动`,
        }],
      },
    });
    expect(createActionResponse.status()).toBe(201);
    const remediationAction = (await createActionResponse.json()).data;
    const remediationEvidence = await page.request.post(
      `http://127.0.0.1:3001/api/remediation-actions/${remediationAction.id}/evidence`,
      {
        headers: userHeaders,
        multipart: {
          file: {
            name: `remediation-${actionIndex}.pdf`,
            mimeType: 'application/pdf',
            buffer: Buffer.from(`%PDF-1.7\nE2E remediation ${actionIndex}\n`),
          },
        },
      },
    );
    expect(remediationEvidence.status()).toBe(201);
    expect((await page.request.post(
      `http://127.0.0.1:3001/api/remediation-actions/${remediationAction.id}/submit`,
      { headers: userHeaders },
    )).ok()).toBeTruthy();
    expect((await page.request.post(
      `http://127.0.0.1:3001/api/risks/${risk.id}/actions/${remediationAction.id}/verify`,
      { headers, data: { decision: 'approved', comment: `行动${actionIndex}通过` } },
    )).ok()).toBeTruthy();
  }

  const closeRiskResponse = await page.request.post(
    `http://127.0.0.1:3001/api/risks/${risk.id}/close`,
    { headers, data: { comment: '全部必要行动已通过' } },
  );
  expect(closeRiskResponse.ok()).toBeTruthy();
  expect((await closeRiskResponse.json()).data.status).toBe('closed');

  const riskExportResponse = await page.request.get(
    'http://127.0.0.1:3001/api/export/risks',
    { headers },
  );
  expect(riskExportResponse.ok()).toBeTruthy();
  expect(riskExportResponse.headers()['content-type']).toContain('spreadsheetml');

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
