import { Tag } from 'antd';

export const lifecycleLabels: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending_review: { label: '待复核', color: 'processing' },
  changes_requested: { label: '已退回', color: 'warning' },
  confirmed: { label: '已确认', color: 'success' },
  superseded: { label: '已取代', color: 'default' },
};

export const conclusionLabels: Record<string, { label: string; color: string }> = {
  not_assessed: { label: '未评估', color: 'default' },
  compliant: { label: '符合', color: 'success' },
  conditionally_compliant: { label: '有条件符合', color: 'warning' },
  non_compliant: { label: '不符合', color: 'error' },
};

export function StatusTag({ value, conclusion = false }: { value?: string; conclusion?: boolean }) {
  const option = (conclusion ? conclusionLabels : lifecycleLabels)[value || ''] || { label: value || '—', color: 'default' };
  return <Tag color={option.color}>{option.label}</Tag>;
}

export const platformOptions = ['Android', 'iOS', 'Web', 'Windows', 'macOS', 'Linux', '其他'].map((value) => ({ value, label: value }));
