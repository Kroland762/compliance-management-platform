import { describe, expect, it } from 'vitest';
import { compactEvaluationFilters, hasEvaluationFilters, parseEvaluationFilters } from './evaluationFilters';

describe('evaluation filter URL state', () => {
  it('round-trips active server filters and removes empty controls', () => {
    const filters = compactEvaluationFilters({
      assetIds: [],
      mine: false,
      answer: 'answered',
      columns: {
        'extraData.检查类型': { operator: 'in', values: ['文档'], includeEmpty: true },
        'extraData.空条件': { operator: 'contains', value: '' },
      },
    });
    expect(filters).toEqual({
      answer: 'answered',
      columns: { 'extraData.检查类型': { operator: 'in', values: ['文档'], includeEmpty: true } },
    });
    expect(parseEvaluationFilters(JSON.stringify(filters))).toEqual(filters);
    expect(hasEvaluationFilters(filters)).toBe(true);
  });

  it('ignores malformed URL state', () => {
    expect(parseEvaluationFilters('{')).toEqual({});
    expect(hasEvaluationFilters({})).toBe(false);
  });
});
