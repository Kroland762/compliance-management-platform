import { expect, request, test } from '@playwright/test';

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
        buffer: Buffer.from(
          '序号,控制域名,控制点,参考回答\n'
          + '1,访问控制,账号复核,应定期复核\n'
          + '2,访问控制,权限复核,应定期复核权限\n',
        ),
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

  const assetSpecs = [
    { code: `E2E-APP-${suffix}`, name: `E2E应用-${suffix}`, assetType: 'application' },
    { code: `E2E-DB-${suffix}`, name: `E2E数据库-${suffix}`, assetType: 'data' },
    { code: `E2E-ORG-${suffix}`, name: `E2E组织治理-${suffix}`, assetType: 'organization' },
  ];
  const createdAssets = [];
  for (const assetSpec of assetSpecs) {
    const assetResponse = await page.request.post('http://127.0.0.1:3001/api/assets', {
      headers,
      data: {
        ...assetSpec,
        criticality: 'high',
        ownerDepartmentId: rootDepartment.id,
        ownerUserId: userId,
      },
    });
    expect(assetResponse.status()).toBe(201);
    createdAssets.push((await assetResponse.json()).data);
  }
  const templateDetailResponse = await page.request.get(
    `http://127.0.0.1:3001/api/templates/${templateId}`,
    { headers },
  );
  const controlPoints = (await templateDetailResponse.json()).data.templateQuestions;
  expect((await page.request.put(`http://127.0.0.1:3001/api/tasks/${taskId}/assets`, {
    headers,
    data: { assetIds: createdAssets.map((asset: any) => asset.id) },
  })).ok()).toBeTruthy();
  const matrixItems = [
    [controlPoints[0], createdAssets[0]],
    [controlPoints[0], createdAssets[1]],
    [controlPoints[1], createdAssets[1]],
    [controlPoints[1], createdAssets[2]],
  ].map(([controlPoint, asset]) => ({
    controlPointId: controlPoint.id,
    assetId: asset.id,
    assignedTo: userId,
    responsibleDepartmentId: rootDepartment.id,
  }));
  expect((await page.request.put(`http://127.0.0.1:3001/api/tasks/${taskId}/control-asset-matrix`, {
    headers,
    data: { items: matrixItems },
  })).ok()).toBeTruthy();
  const publishResponse = await page.request.post(
    `http://127.0.0.1:3001/api/tasks/${taskId}/publish`,
    { headers },
  );
  expect(publishResponse.ok()).toBeTruthy();
  expect((await publishResponse.json()).data.total).toBe(4);
  const evaluationsResponse = await page.request.get(
    `http://127.0.0.1:3001/api/tasks/${taskId}/evaluations?pageSize=100`,
    { headers },
  );
  const evaluations = (await evaluationsResponse.json()).data.items;
  expect(evaluations).toHaveLength(4);

  const missingPrecondition = await page.request.put(
    `http://127.0.0.1:3001/api/evaluations/${evaluations[0].id}/answer`,
    { headers, data: { currentStatusDescription: '缺少版本号的写入不得成功' } },
  );
  expect(missingPrecondition.status()).toBe(428);
  for (const legacyWrite of [
    page.request.put(`http://127.0.0.1:3001/api/questions/${evaluations[0].id}/answer`, {
      headers,
      data: { currentStatusDescription: '旧入口不得写入', lockVersion: evaluations[0].lockVersion },
    }),
    page.request.put(`http://127.0.0.1:3001/api/review/questions/${evaluations[0].id}`, {
      headers,
      data: { complianceStatus: 'compliant' },
    }),
    page.request.put(`http://127.0.0.1:3001/api/tasks/${taskId}/configure`, {
      headers,
      data: { questionAssignments: [] },
    }),
    page.request.post(`http://127.0.0.1:3001/api/tasks/${taskId}/submit`, { headers }),
  ]) {
    expect((await legacyWrite).status()).toBe(410);
  }

  // Keep the member's refresh-token cookie isolated from the administrator's
  // browser context so the final rendered administrator workflow remains valid.
  const memberRequest = await request.newContext({ baseURL: 'http://127.0.0.1:3001' });
  const userLoginResponse = await memberRequest.post('/api/auth/login', {
    data: {
      username: `e2e_user_${suffix}`,
      password: temporaryPassword,
      captchaCode: '0000',
    },
  });
  expect(userLoginResponse.ok()).toBeTruthy();
  const temporaryToken = (await userLoginResponse.json()).data.token;
  const changePasswordResponse = await memberRequest.post('/api/auth/change-password', {
    headers: { Authorization: `Bearer ${temporaryToken}` },
    data: { oldPassword: temporaryPassword, newPassword: 'E2eUserChanged1234!' },
  });
  expect(changePasswordResponse.ok()).toBeTruthy();
  const changedLoginResponse = await memberRequest.post('/api/auth/login', {
    data: {
      username: `e2e_user_${suffix}`,
      password: 'E2eUserChanged1234!',
      captchaCode: '0000',
    },
  });
  expect(changedLoginResponse.ok()).toBeTruthy();
  const userToken = (await changedLoginResponse.json()).data.token;
  await memberRequest.dispose();
  const userHeaders = {
    Authorization: `Bearer ${userToken}`,
    'X-Tenant-ID': auth.selectedTenant.id,
  };

  const answeredEvaluations = [];
  for (const evaluation of evaluations) {
    const answerResponse = await page.request.put(
      `http://127.0.0.1:3001/api/evaluations/${evaluation.id}/answer`,
      {
        headers: userHeaders,
        data: {
          currentStatusDescription: `已检查 ${evaluation.sequenceNumber} 与资产 ${evaluation.asset?.name}`,
          lockVersion: evaluation.lockVersion,
        },
      },
    );
    expect(answerResponse.ok()).toBeTruthy();
    answeredEvaluations.push((await answerResponse.json()).data);
  }

  const evidenceResponse = await page.request.post(`http://127.0.0.1:3001/api/evaluations/${evaluations[0].id}/evidence`, {
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

  const submittedEvaluations = [];
  for (const evaluation of answeredEvaluations) {
    const submitResponse = await page.request.post(
      `http://127.0.0.1:3001/api/evaluations/${evaluation.id}/submit`,
      {
        headers: { ...userHeaders, 'If-Match': `"${evaluation.lockVersion}"` },
      },
    );
    expect(submitResponse.ok()).toBeTruthy();
    const submitted = (await submitResponse.json()).data;
    expect(submitted.workflowStatus).toBe('submitted');
    submittedEvaluations.push(submitted);
  }

  const reviewDataResponse = await page.request.get(`http://127.0.0.1:3001/api/review/tasks/${taskId}`, { headers });
  expect(reviewDataResponse.ok()).toBeTruthy();
  const reviewEvaluation = (await reviewDataResponse.json()).data
    .find((item: any) => item.id === evaluations[0].id);
  expect(reviewEvaluation.evidenceFiles[0].id).toBe(evidenceId);
  expect(reviewEvaluation.evidenceFiles[0].storageKey).toBeUndefined();
  expect(reviewEvaluation.evidenceFiles[0].filePath).toBeUndefined();

  const reviewedEvaluations = [];
  for (const evaluation of submittedEvaluations) {
    const reviewResponse = await page.request.post(
      `http://127.0.0.1:3001/api/evaluations/${evaluation.id}/review`,
      {
        headers: { ...headers, 'If-Match': `"${evaluation.lockVersion}"` },
        data: { complianceStatus: 'non_compliant' },
      },
    );
    expect(reviewResponse.ok()).toBeTruthy();
    reviewedEvaluations.push((await reviewResponse.json()).data);
  }

  const firstRiskResponse = await page.request.post('http://127.0.0.1:3001/api/risks', {
    headers: { ...headers, 'Idempotency-Key': `e2e-risk-first-${suffix}` },
    data: {
      taskId,
      title: `E2E共享风险-${suffix}`,
      description: '三个评估单元共同形成高风险',
      riskLevel: 'high',
      treatmentStrategy: 'mitigate',
      ownerDepartmentId: rootDepartment.id,
      ownerUserId: userId,
      sources: reviewedEvaluations.slice(0, 3).map((evaluation: any) => ({
        controlEvaluationId: evaluation.id,
      })),
      assets: createdAssets.map((asset: any) => ({ assetId: asset.id })),
    },
  });
  expect(firstRiskResponse.status()).toBe(201);
  const risk = (await firstRiskResponse.json()).data;
  expect(risk.sources).toHaveLength(3);
  expect(risk.affectedAssets).toHaveLength(3);

  const secondRiskResponse = await page.request.post('http://127.0.0.1:3001/api/risks', {
    headers: { ...headers, 'Idempotency-Key': `e2e-risk-second-${suffix}` },
    data: {
      taskId,
      title: `E2E组织风险-${suffix}`,
      description: '组织治理评估单元形成独立风险',
      riskLevel: 'medium',
      treatmentStrategy: 'mitigate',
      ownerDepartmentId: rootDepartment.id,
      ownerUserId: userId,
      sources: [{ controlEvaluationId: reviewedEvaluations[3].id }],
      assets: [{ assetId: createdAssets[2].id }],
    },
  });
  expect(secondRiskResponse.status()).toBe(201);
  const secondRisk = (await secondRiskResponse.json()).data;

  const completeReviewResponse = await page.request.post(
    `http://127.0.0.1:3001/api/tasks/${taskId}/complete-review`,
    { headers },
  );
  expect(completeReviewResponse.ok()).toBeTruthy();
  expect((await completeReviewResponse.json()).data.status).toBe('completed');

  expect((await page.request.post(
    `http://127.0.0.1:3001/api/risks/${risk.id}/confirm`,
    { headers: { ...headers, 'If-Match': `"${risk.lockVersion}"` } },
  )).ok()).toBeTruthy();
  expect((await page.request.post(
    `http://127.0.0.1:3001/api/risks/${secondRisk.id}/confirm`,
    { headers: { ...headers, 'If-Match': `"${secondRisk.lockVersion}"` } },
  )).ok()).toBeTruthy();

  const createAndSubmitAction = async (
    actionIndex: number,
    riskLinks: Array<{ riskId: string; contributionDescription: string }>,
  ) => {
    const createActionResponse = await page.request.post('http://127.0.0.1:3001/api/remediation-actions', {
      headers,
      data: {
        title: `E2E整改行动${actionIndex}-${suffix}`,
        description: `完成第${actionIndex}项整改`,
        ownerUserId: userId,
        ownerDepartmentId: rootDepartment.id,
        dueDate: '2030-12-31',
        riskLinks: riskLinks.map((link) => ({
          riskId: link.riskId,
          isRequired: true,
          contributionDescription: link.contributionDescription,
        })),
      },
    });
    expect(createActionResponse.status()).toBe(201);
    let remediationAction = (await createActionResponse.json()).data;
    const updateActionResponse = await page.request.put(
      `http://127.0.0.1:3001/api/remediation-actions/${remediationAction.id}`,
      {
        headers: { ...userHeaders, 'If-Match': `"${remediationAction.lockVersion}"` },
        data: { progressNote: `第${actionIndex}项整改已完成并验证` },
      },
    );
    expect(updateActionResponse.ok()).toBeTruthy();
    remediationAction = (await updateActionResponse.json()).data;
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
    const submittedResponse = await page.request.post(
      `http://127.0.0.1:3001/api/remediation-actions/${remediationAction.id}/submit`,
      {
        headers: {
          ...userHeaders,
          'If-Match': `"${remediationAction.lockVersion}"`,
          'Idempotency-Key': `e2e-submit-${suffix}-${actionIndex}`,
        },
      },
    );
    expect(submittedResponse.ok()).toBeTruthy();
    return (await submittedResponse.json()).data;
  };

  let sharedAction = await createAndSubmitAction(1, [
    { riskId: risk.id, contributionDescription: '统一收敛账号权限' },
    { riskId: secondRisk.id, contributionDescription: '补齐组织权限复核机制' },
  ]);
  const rejectedResponse = await page.request.post(
    `http://127.0.0.1:3001/api/risks/${risk.id}/actions/${sharedAction.id}/verify`,
    {
      headers: { ...headers, 'If-Match': `"${sharedAction.lockVersion}"` },
      data: { decision: 'rejected', comment: '证据不足，请补充验证记录' },
    },
  );
  expect(rejectedResponse.ok()).toBeTruthy();
  sharedAction = (await rejectedResponse.json()).data;
  const fixedResponse = await page.request.put(
    `http://127.0.0.1:3001/api/remediation-actions/${sharedAction.id}`,
    {
      headers: { ...userHeaders, 'If-Match': `"${sharedAction.lockVersion}"` },
      data: { progressNote: '已按驳回意见补充完整验证记录' },
    },
  );
  sharedAction = (await fixedResponse.json()).data;
  const resubmitResponse = await page.request.post(
    `http://127.0.0.1:3001/api/remediation-actions/${sharedAction.id}/submit`,
    {
      headers: {
        ...userHeaders,
        'If-Match': `"${sharedAction.lockVersion}"`,
        'Idempotency-Key': `e2e-resubmit-${suffix}`,
      },
    },
  );
  expect(resubmitResponse.ok()).toBeTruthy();
  sharedAction = (await resubmitResponse.json()).data;

  for (const linkedRisk of [risk, secondRisk]) {
    const approveResponse = await page.request.post(
      `http://127.0.0.1:3001/api/risks/${linkedRisk.id}/actions/${sharedAction.id}/verify`,
      {
        headers: { ...headers, 'If-Match': `"${sharedAction.lockVersion}"` },
        data: { decision: 'approved', comment: '补充后复核通过' },
      },
    );
    expect(approveResponse.ok()).toBeTruthy();
    sharedAction = (await approveResponse.json()).data;
  }

  let secondAction = await createAndSubmitAction(2, [
    { riskId: risk.id, contributionDescription: '补充账号季度复核自动提醒' },
  ]);
  const secondActionApprove = await page.request.post(
    `http://127.0.0.1:3001/api/risks/${risk.id}/actions/${secondAction.id}/verify`,
    {
      headers: { ...headers, 'If-Match': `"${secondAction.lockVersion}"` },
      data: { decision: 'approved', comment: '第二项必要行动通过' },
    },
  );
  expect(secondActionApprove.ok()).toBeTruthy();
  secondAction = (await secondActionApprove.json()).data;

  const closableRisk = (await (await page.request.get(
    `http://127.0.0.1:3001/api/risks/${risk.id}`,
    { headers },
  )).json()).data;
  const closeRiskResponse = await page.request.post(
    `http://127.0.0.1:3001/api/risks/${risk.id}/close`,
    {
      headers: { ...headers, 'If-Match': `"${closableRisk.lockVersion}"` },
      data: { comment: '全部必要行动已通过' },
    },
  );
  expect(closeRiskResponse.ok()).toBeTruthy();
  expect((await closeRiskResponse.json()).data.status).toBe('closed');

  const closableSecondRisk = (await (await page.request.get(
    `http://127.0.0.1:3001/api/risks/${secondRisk.id}`,
    { headers },
  )).json()).data;
  const closeSecondRiskResponse = await page.request.post(
    `http://127.0.0.1:3001/api/risks/${secondRisk.id}/close`,
    {
      headers: { ...headers, 'If-Match': `"${closableSecondRisk.lockVersion}"` },
      data: { comment: '共享必要行动已通过' },
    },
  );
  expect(closeSecondRiskResponse.ok()).toBeTruthy();

  const riskExportResponse = await page.request.get(
    'http://127.0.0.1:3001/api/export/risks',
    { headers: { ...headers, 'Idempotency-Key': `e2e-export-${suffix}` } },
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

  await page.goto('/assessments/new');
  await page.getByRole('combobox', { name: '标准版本' }).click();
  await page.locator('.ant-select-item-option', { hasText: `E2E模板-${suffix}` }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('评估名称').fill(`E2E稀疏矩阵-${suffix}`);
  await page.getByRole('combobox', { name: '归属部门' }).click();
  await page.locator('.ant-select-item-option', { hasText: rootDepartment.name }).first().click();
  await page.getByRole('button', { name: '下一步' }).click();
  const assetSearch = page.locator('main input[role="combobox"]');
  await expect(assetSearch).toBeVisible();
  for (const asset of createdAssets) {
    await assetSearch.click();
    await page.keyboard.type(asset.name);
    await page.locator('.ant-select-item-option', { hasText: asset.name }).click();
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('已启用 6 / 6 个组合')).toBeVisible();
  const matrixCheckboxes = page.locator('main').getByRole('checkbox');
  await expect(matrixCheckboxes).toHaveCount(6);
  await matrixCheckboxes.nth(4).click();
  await matrixCheckboxes.nth(5).click();
  await expect(page.getByText('已启用 4 / 6 个组合')).toBeVisible();

  await page.goto('/users');
  await page.getByPlaceholder('搜索成员姓名').fill(`E2E User ${suffix}`);
  await expect(page.getByText(`e2e_user_${suffix}`)).toBeVisible();
});
