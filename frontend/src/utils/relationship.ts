export interface MatrixSeed {
  id: string;
  sequenceNumber: string;
  controlPoint: string;
}

export interface AssetSeed {
  id: string;
  name: string;
}

export function buildControlAssetMatrix(
  controls: MatrixSeed[],
  assets: AssetSeed[],
  responsibleDepartmentId?: string,
  assignedTo?: string,
) {
  return controls.flatMap((control) => assets.map((asset) => ({
    key: `${control.id}:${asset.id}`,
    controlPointId: control.id,
    assetId: asset.id,
    sequenceNumber: control.sequenceNumber,
    controlPoint: control.controlPoint,
    assetName: asset.name,
    responsibleDepartmentId,
    assignedTo,
    enabled: true,
  })));
}

export function enabledMatrixRows<T extends { enabled?: boolean }>(rows: T[]): T[] {
  return rows.filter((row) => row.enabled !== false);
}

export function canCloseRisk(actionLinks: Array<{
  isRequired: boolean;
  verificationStatus: string;
  action?: { status?: string };
}>): boolean {
  const required = actionLinks.filter((link) => link.isRequired);
  return required.length > 0 && required.every(
    (link) => link.verificationStatus === 'approved' && link.action?.status === 'completed',
  );
}

export function uniquePrimaryCount<T>(rows: T[], key: (row: T) => string): number {
  return new Set(rows.map(key)).size;
}
