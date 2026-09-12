import { describe, expect, test } from 'vitest';
import { parseEvaluationQuery } from '../src/utils/evaluation-filters';

describe('evaluation filter query validation', () => {
  test('parses typed filters and preserves same-column OR values', () => {
    const filters = {
      assetIds: ['asset-1', 'asset-2'],
      workflowStatuses: ['in_progress', 'returned'],
      complianceStatuses: ['partial'],
      mine: true,
      answer: 'answered',
      evidence: 'present',
      history: 'absent',
      sequenceNumber: 'A.1',
      controlPoint: '身份',
      columns: {
        'extraData.检查类型': { operator: 'in', values: ['访谈', '文档'], includeEmpty: true },
        'extraData.检查内容': { operator: 'contains', value: '权限' },
      },
    };
    expect(parseEvaluationQuery({ q: '鉴别', filters: JSON.stringify(filters) })).toEqual({ q: '鉴别', filters });
  });

  test.each([
    [{ filters: '{' }, 'filters 不是有效的 JSON'],
    [{ filters: JSON.stringify({ mine: 'yes' }) }, '仅看待我处理必须是布尔值'],
    [{ filters: JSON.stringify({ workflowStatuses: ['unknown'] }) }, '流程状态 包含无效值'],
    [{ filters: JSON.stringify({ columns: { 'extraData.x': { operator: 'regex', value: 'x' } } }) }, '筛选运算符无效'],
    [{ q: 'x'.repeat(201) }, '关键词 最多 200 个字符'],
  ])('rejects invalid input %#', (query, message) => {
    expect(() => parseEvaluationQuery(query)).toThrow(message);
  });

  test('enforces dynamic column and multi-value limits', () => {
    const columns = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [
      `extraData.${index}`, { operator: 'contains', value: 'x' },
    ]));
    expect(() => parseEvaluationQuery({ filters: JSON.stringify({ columns }) })).toThrow('动态列筛选最多 20 项');
    expect(() => parseEvaluationQuery({
      filters: JSON.stringify({ assetIds: Array.from({ length: 51 }, (_, index) => `asset-${index}`) }),
    })).toThrow('关联资产 最多选择 50 项');
  });
});
