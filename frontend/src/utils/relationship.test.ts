import { describe, expect, it } from 'vitest';
import { buildControlAssetMatrix, canCloseRisk, uniquePrimaryCount } from './relationship';

describe('vNext relationship graph helpers', () => {
  it('builds one evaluation for every selected control and asset pair', () => {
    const rows = buildControlAssetMatrix(
      [
        { id: 'c1', sequenceNumber: 'A.1', controlPoint: '身份鉴别' },
        { id: 'c2', sequenceNumber: 'A.2', controlPoint: '权限复核' },
      ],
      [{ id: 'a1', name: '应用' }, { id: 'a2', name: '数据库' }],
      'department-1',
    );
    expect(rows).toHaveLength(4);
    expect(uniquePrimaryCount(rows, (row) => `${row.controlPointId}:${row.assetId}`)).toBe(4);
  });

  it('requires every necessary link to be completed and approved before closing', () => {
    expect(canCloseRisk([])).toBe(false);
    expect(canCloseRisk([
      { isRequired: true, verificationStatus: 'approved', action: { status: 'completed' } },
      { isRequired: true, verificationStatus: 'pending', action: { status: 'completed' } },
    ])).toBe(false);
    expect(canCloseRisk([
      { isRequired: true, verificationStatus: 'approved', action: { status: 'completed' } },
      { isRequired: false, verificationStatus: 'pending', action: { status: 'in_progress' } },
    ])).toBe(true);
  });

  it('counts primary records without multiplying many-to-many joins', () => {
    const joinedRows = [
      { riskId: 'r1', assetId: 'a1' },
      { riskId: 'r1', assetId: 'a2' },
      { riskId: 'r2', assetId: 'a2' },
    ];
    expect(uniquePrimaryCount(joinedRows, (row) => row.riskId)).toBe(2);
  });
});
