import { afterEach, describe, expect, test, vi } from 'vitest';
import { Op } from 'sequelize';
import { config } from '../src/config';
import AccountAuditTask from '../src/models/account/AuditTask';
import { resolveLegacyEvidencePath } from '../src/services/evidence-preview.service';
import memberService from '../src/services/member.service';
import objectAccessService from '../src/services/object-access.service';
import qualificationService from '../src/services/qualification.service';

const originalLegacyDir = config.upload.legacyEvidenceDir;

const scopedUser: any = {
  userId: '00000000-0000-4000-8000-000000000001',
  memberId: '00000000-0000-4000-8000-000000000101',
  isGlobalAdmin: false,
  departmentIds: ['00000000-0000-4000-8000-000000000201'],
  permissions: {},
  permissionScopes: {
    data_sources: { read: 'assigned' },
    account_tasks: { read: 'assigned' },
    problems: { read: 'assigned' },
    assessment_plans: { read: 'department' },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  config.upload.legacyEvidenceDir = originalLegacyDir;
});

describe('security boundary regressions', () => {
  test('does not resolve legacy evidence filePath without an explicit root', () => {
    config.upload.legacyEvidenceDir = '';
    expect(() => resolveLegacyEvidencePath('/etc/passwd')).toThrow(/旧路径未配置/);
  });

  test('confines legacy evidence paths to LEGACY_EVIDENCE_DIR', () => {
    config.upload.legacyEvidenceDir = '/srv/compliance/legacy-evidence';
    expect(resolveLegacyEvidencePath('tenant-a/report.pdf')).toBe('/srv/compliance/legacy-evidence/tenant-a/report.pdf');
    expect(() => resolveLegacyEvidencePath('../secrets.env')).toThrow(/路径非法/);
    config.upload.legacyEvidenceDir = '/';
    expect(() => resolveLegacyEvidencePath('etc/passwd')).toThrow(/根目录配置非法/);
  });

  test('scopes account audit objects by creator unless the action scope is all', async () => {
    await expect(objectAccessService.accountDataSourceScope(scopedUser, 'read')).resolves.toEqual({
      createdBy: scopedUser.userId,
    });
    await expect(objectAccessService.accountTaskScope(scopedUser, 'read')).resolves.toEqual({
      createdBy: scopedUser.userId,
    });
    await expect(objectAccessService.accountDataSourceScope({
      ...scopedUser,
      permissionScopes: { data_sources: { read: 'all' } },
    }, 'read')).resolves.toEqual({});
  });

  test('uses problem permission scope rather than account task scope for problem data', async () => {
    const findTasks = vi.spyOn(AccountAuditTask, 'findAll').mockResolvedValue([
      { id: 'task-owned-by-user' },
    ] as any);
    const where = await objectAccessService.accountProblemScope({
      ...scopedUser,
      permissionScopes: {
        ...scopedUser.permissionScopes,
        account_tasks: { read: 'all' },
        problems: { read: 'assigned' },
      },
    }, 'read') as any;

    expect(findTasks).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdBy: scopedUser.userId },
    }));
    expect(where.taskId[Op.in]).toEqual(['task-owned-by-user']);
  });

  test('uses assessment plan department ownership for department scopes', async () => {
    const where = await objectAccessService.assessmentPlanScope(scopedUser, 'read') as any;
    expect(where.defaultDepartmentId[Op.in]).toEqual(scopedUser.departmentIds);
  });

  test('rejects unsafe qualification attachment URLs while preserving HTTPS links', () => {
    expect(() => (qualificationService as any).clean({
      name: '证照',
      category: '经营资质',
      attachmentUrl: 'javascript:alert(1)',
    })).toThrow(/HTTPS/);
    expect((qualificationService as any).clean({
      attachmentUrl: 'https://example.com/cert.pdf',
    })).toEqual({ attachmentUrl: 'https://example.com/cert.pdf' });
  });

  test('prevents scoped user managers from granting themselves tenant admin', async () => {
    await expect((memberService as any).assertAssignableRoles(
      scopedUser,
      scopedUser.memberId,
      [{ id: 'tenant-admin-role', systemKey: 'tenant_admin' }],
      {},
    )).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    await expect((memberService as any).assertAssignableRoles(
      { ...scopedUser, permissionScopes: { users: { update: 'all' } } },
      scopedUser.memberId,
      [{ id: 'tenant-admin-role', systemKey: 'tenant_admin' }],
      {},
    )).resolves.toBeUndefined();
  });
});
