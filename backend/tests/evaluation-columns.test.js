import { afterEach, describe, expect, test, vi } from 'vitest';
import { normalizeEvaluationColumnSchema } from '../src/utils/evaluation-columns';
import { AuditTask, QuestionnaireTemplate, OperationType } from '../src/models';
import auditLogService from '../src/services/audit-log.service';
import taskService from '../src/services/task.service';
import goldenFixtures from '../../fixtures/evaluation-columns.golden.json';

afterEach(() => vi.restoreAllMocks());

describe('evaluation column schema', () => {
  test.each(goldenFixtures)('matches shared golden fixture: $name', ({ input, expectedKeys }) => {
    const normalized = normalizeEvaluationColumnSchema(input);
    expect(normalized.map((column) => column.key)).toEqual(expectedKeys);
    expect(normalized.filter((column) => column.source === 'system').every((column) => column.visible)).toBe(true);
  });

  test('adds workflow columns to legacy template layouts in the recommended order', () => {
    const normalized = normalizeEvaluationColumnSchema([
      { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 140 },
      { key: 'controlDomain', label: '控制域名', source: 'core', visible: true, width: 240 },
      { key: 'controlPoint', label: '控制点', source: 'core', visible: true, width: 320 },
      { key: 'referenceAnswer', label: '参考回答', source: 'core', visible: true, width: 240 },
    ]);

    expect(normalized.map((column) => column.key)).toEqual([
      'sequenceNumber', 'controlPoint', 'assets', 'assignee', 'answer', 'controlDomain',
      'evidence', 'history', 'compliance', 'findingDescription', 'findingSeverity', 'status', 'actions',
    ]);
    expect(normalized.some((column) => column.key === 'referenceAnswer')).toBe(false);
  });

  test('keeps the complete saved order and restores missing locked columns', () => {
    const normalized = normalizeEvaluationColumnSchema([
      { key: 'answer', label: '说明', source: 'system', visible: false, width: 100 },
      { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 100 },
      { key: 'assets', label: '资产', source: 'system', visible: true, width: 100 },
      { key: 'controlPoint', label: '评估点', source: 'core', visible: true, width: 400 },
    ]);

    expect(normalized.map((column) => column.key)).toEqual([
      'answer', 'sequenceNumber', 'assets', 'assignee', 'controlPoint',
      'evidence', 'history', 'compliance', 'findingDescription', 'findingSeverity', 'status', 'actions',
    ]);
    expect(normalized.every((column) => column.visible)).toBe(true);
  });
});

describe('task column schema synchronization', () => {
  test('copies only the normalized template column layout into an existing task snapshot', async () => {
    const update = vi.fn(async () => undefined);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue({
      id: 'task-1',
      templateId: 'template-1',
      departmentId: 'department-1',
      columnSchemaSnapshot: [{ key: 'sequenceNumber' }],
      update,
    });
    vi.spyOn(QuestionnaireTemplate, 'findByPk').mockResolvedValue({
      id: 'template-1',
      name: 'ISO 示例',
      columnSchema: [
        { key: 'history', label: '历史回答与证据', source: 'system', visible: true, width: 150 },
        { key: 'referenceAnswer', label: '参考回答', source: 'core', visible: true, width: 240 },
        { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 100 },
        { key: 'controlPoint', label: '评估点与要求', source: 'core', visible: true, width: 400 },
        { key: 'assets', label: '关联资产', source: 'system', visible: true, width: 260 },
      ],
    });
    const audit = vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);

    const result = await taskService.syncColumnSchema('task-1', 'admin-1');

    expect(result.columnSchemaSnapshot.map((column) => column.key)).toEqual([
      'history', 'sequenceNumber', 'controlPoint', 'assets', 'assignee',
      'answer', 'evidence', 'compliance', 'findingDescription', 'findingSeverity', 'status', 'actions',
    ]);
    expect(update).toHaveBeenCalledWith({ columnSchemaSnapshot: result.columnSchemaSnapshot });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: 'task-1',
      departmentId: 'department-1',
    }));
  });
});
