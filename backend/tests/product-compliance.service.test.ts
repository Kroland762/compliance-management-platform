import { afterEach, describe, expect, test, vi } from 'vitest';
import sequelize from '../src/config/database';
import {
  APP_COMPLIANCE_QUESTIONS,
  BASELINE_COMPLIANCE_QUESTIONS,
  PERSONAL_DATA_CATALOG_ITEMS,
  THIRD_PARTY_ASSESSMENT_ITEMS,
} from '../src/config/product-compliance-template-seed';
import {
  Department,
  Product,
  ProductComplianceDossier,
  ProductQuestionnaireTemplate,
  ProductType,
  TenantMember,
} from '../src/models';
import { PERMISSION_DEFINITIONS } from '../src/models/Role';
import auditLogService from '../src/services/audit-log.service';
import lookupService from '../src/services/lookup.service';
import objectAccessService from '../src/services/object-access.service';
import service from '../src/services/product-compliance.service';

const actor: any = {
  userId: 'user-1', username: 'owner', role: 'member', roleIds: ['role-1'], tenantId: 'tenant-1',
  permissions: { products: ['create', 'read'], product_dossiers: ['read', 'update', 'submit'] },
  permissionScopes: { products: { read: 'assigned' }, product_dossiers: { update: 'assigned' } },
  departmentIds: ['department-1'], primaryDepartmentId: 'department-1', isGlobalAdmin: false,
  mustChangePassword: false, tokenKind: 'tenant', sessionId: 'session-1',
};

describe('product compliance service', () => {
  afterEach(() => vi.restoreAllMocks());

  test('defines separate RBAC resources for products, dossiers and configuration', () => {
    expect(PERMISSION_DEFINITIONS.products).toEqual(['create', 'read', 'update', 'archive']);
    expect(PERMISSION_DEFINITIONS.product_dossiers).toContain('confirm');
    expect(PERMISSION_DEFINITIONS.product_compliance_config).toContain('retire');
  });

  test('embeds APP and SDK dossier template source data as system seed constants', () => {
    expect(BASELINE_COMPLIANCE_QUESTIONS).toHaveLength(10);
    expect(APP_COMPLIANCE_QUESTIONS).toHaveLength(27);
    expect(PERSONAL_DATA_CATALOG_ITEMS).toHaveLength(150);
    expect(THIRD_PARTY_ASSESSMENT_ITEMS.length).toBeGreaterThan(50);
    expect(APP_COMPLIANCE_QUESTIONS[0].stableKey).toMatch(/^app_check_/);
    expect(PERSONAL_DATA_CATALOG_ITEMS[0]).toEqual(expect.objectContaining({ name: '姓名', category: '基本个人信息' }));
  });

  test('creates a normalized product only with an active type and valid tenant owners', async () => {
    vi.spyOn(ProductType, 'findOne').mockResolvedValue({ id: 'type-1' } as any);
    vi.spyOn(Department, 'findOne').mockResolvedValue({ id: 'department-1' } as any);
    vi.spyOn(TenantMember, 'findOne').mockResolvedValue({ id: 'member-1' } as any);
    vi.spyOn(lookupService, 'assertOwners').mockResolvedValue();
    vi.spyOn(Product, 'findOne').mockResolvedValue(null);
    vi.spyOn(Product, 'create').mockImplementation(async (input: any) => ({ id: 'product-1', ...input }) as any);
    vi.spyOn(auditLogService, 'log').mockResolvedValue({} as any);

    const created = await service.createProduct({
      code: ' mobile_app ', name: '  移动应用  ', defaultProductTypeId: 'type-1',
      ownerUserId: 'user-1', ownerDepartmentId: 'department-1', description: null,
    }, actor);

    expect(created.code).toBe('MOBILE_APP');
    expect(created.name).toBe('移动应用');
    expect(auditLogService.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'product', resourceId: 'product-1' }));
  });

  test('rejects changes to content of an activated questionnaire template', async () => {
    vi.spyOn(ProductQuestionnaireTemplate, 'findByPk').mockResolvedValue({ id: 'template-1', status: 'active' } as any);
    await expect(service.updateTemplate('template-1', { name: '覆盖历史名称' }, actor))
      .rejects.toMatchObject({ code: 'TEMPLATE_IMMUTABLE', statusCode: 409 });
  });

  test('prevents a submitter from reviewing their own dossier', async () => {
    const accessible = { id: 'dossier-1', lockVersion: 3 } as any;
    const locked = { id: 'dossier-1', lockVersion: 3, lifecycleStatus: 'pending_review', submittedBy: actor.userId, update: vi.fn() } as any;
    vi.spyOn(objectAccessService, 'dossierOrNotFound').mockResolvedValue(accessible);
    vi.spyOn(ProductComplianceDossier, 'findByPk').mockResolvedValue(locked);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));

    await expect(service.returnForChanges('dossier-1', '需要补充', 3, actor))
      .rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN', statusCode: 409 });
    expect(locked.update).not.toHaveBeenCalled();
  });

  test('rejects stale dossier updates before changing workflow state', async () => {
    vi.spyOn(objectAccessService, 'dossierOrNotFound').mockResolvedValue({ id: 'dossier-1', lockVersion: 4 } as any);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    await expect(service.confirm('dossier-1', 'compliant', 3, { ...actor, userId: 'reviewer-1' }))
      .rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });
});
