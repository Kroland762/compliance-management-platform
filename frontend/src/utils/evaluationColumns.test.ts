import { describe, expect, it } from 'vitest';
import {
  LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS,
  normalizeEvaluationColumnSchema,
} from './evaluationColumns';
import goldenFixtures from '../../../fixtures/evaluation-columns.golden.json';

describe('evaluation column layout', () => {
  it.each(goldenFixtures)('matches shared golden fixture: $name', ({ input, expectedKeys }) => {
    const normalized = normalizeEvaluationColumnSchema(input as any);
    expect(normalized.map((column) => column.key)).toEqual(expectedKeys);
    expect(normalized.filter((column) => column.source === 'system').every((column) => column.visible)).toBe(true);
  });

  it('upgrades a legacy template schema to the recommended full-table order', () => {
    const result = normalizeEvaluationColumnSchema([
      { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 140 },
      { key: 'controlDomain', label: '控制域名', source: 'core', visible: true, width: 240 },
      { key: 'controlPoint', label: '控制点', source: 'core', visible: true, width: 320 },
      { key: 'referenceAnswer', label: '参考回答', source: 'core', visible: true, width: 240 },
      { key: 'extraData.来源章节', label: '来源章节', source: 'extra', visible: false, width: 160 },
    ]);

    expect(result.map((column) => column.key)).toEqual([
      'sequenceNumber', 'controlPoint', 'assets', 'assignee', 'answer', 'controlDomain',
      'extraData.来源章节', 'evidence', 'history', 'compliance', 'findingDescription',
      'findingSeverity', 'status', 'actions',
    ]);
    expect(result.find((column) => column.key === 'extraData.来源章节')?.visible).toBe(false);
    expect(result.some((column) => column.key === 'referenceAnswer')).toBe(false);
  });

  it('preserves the complete administrator-defined order while keeping required columns visible', () => {
    const result = normalizeEvaluationColumnSchema([
      { key: 'status', label: '状态', source: 'system', visible: false, width: 90 },
      { key: 'sequenceNumber', label: '编号', source: 'core', visible: false, width: 40 },
      { key: 'controlPoint', label: '控制点', source: 'core', visible: true, width: 200 },
      { key: 'assets', label: '资产', source: 'system', visible: true, width: 180 },
      { key: 'answer', label: '说明', source: 'system', visible: true, width: 240 },
      { key: 'controlDomain', label: '控制域', source: 'core', visible: true, width: 160 },
      { key: 'actions', label: '操作', source: 'system', visible: true, width: 100 },
      { key: 'evidence', label: '证据', source: 'system', visible: true, width: 120 },
      { key: 'history', label: '历史', source: 'system', visible: true, width: 100 },
    ]);

    expect(result.map((column) => column.key)).toEqual([
      'compliance', 'findingDescription', 'findingSeverity', 'status', 'sequenceNumber', 'controlPoint', 'assets', 'assignee', 'answer',
      'controlDomain', 'actions', 'evidence', 'history',
    ]);
    expect(result.filter((column) => LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS.has(column.key)).every((column) => column.visible)).toBe(true);
  });
});
