// ========================================
// 统一的状态映射 — 所有页面共用
// ========================================

/** 审计员/管理员视角 — 任务列表 */
export const TASK_STATUS: Record<string, { color: string; text: string }> = {
  preparing: { color: 'default', text: '准备中' },
  ready: { color: 'blue', text: '待开始' },
  in_progress: { color: 'processing', text: '进行中' },
  pending_review: { color: 'purple', text: '待复核' },
  pending_closure: { color: 'orange', text: '待闭环' },
  closed: { color: 'success', text: '已关闭' },
  cancelled: { color: 'default', text: '已取消' },
};

/** 普通用户视角 — 我的任务（按个人答题进度） */
export const MY_TASK_USER_STATUS = {
  get: (record: { _myStats?: { myTotal: number; myAnswered: number }; returnReason?: string }): { text: string; color: string } => {
    const my = record._myStats || { myTotal: 0, myAnswered: 0 };
    if (my.myTotal === 0) return { text: '—', color: 'default' };
    if (record.returnReason) return { text: '被退回', color: 'red' };
    if (my.myAnswered === 0) return { text: '未开始', color: 'default' };
    if (my.myAnswered < my.myTotal) return { text: '进行中', color: 'processing' };
    return { text: '已提交', color: 'green' };
  },
};

/** 调查问卷详情页 — canEdit 状态 */
export const CAN_EDIT_TASK_STATUS = ['ready', 'in_progress'] as const;

/** 审阅页 — 可审阅状态 */
export const CAN_REVIEW_STATUS = ['pending_review'] as const;

/** 风险级别 */
export const RISK_LEVEL: Record<string, { color: string; text: string }> = {
  critical: { color: 'magenta', text: '严重' },
  high: { color: 'red', text: '高' },
  medium: { color: 'orange', text: '中' },
  low: { color: 'green', text: '低' },
};

/** 符合性状态 */
export const COMPLIANCE_STATUS_OPTIONS = [
  { value: 'compliant', label: '符合', color: 'green' },
  { value: 'partial', label: '部分符合', color: 'orange' },
  { value: 'non_compliant', label: '不符合', color: 'red' },
  { value: 'not_applicable', label: '不适用', color: 'default' },
];

export const COMPLIANCE_STATUS: Record<string, { color: string; text: string }> =
  Object.fromEntries(COMPLIANCE_STATUS_OPTIONS.map(o => [o.value, { color: o.color, text: o.label }]));

export const RISK_STATUS: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  pending_confirmation: { color: 'orange', text: '待确认' },
  open: { color: 'blue', text: '已识别' },
  remediating: { color: 'processing', text: '整改中' },
  pending_verification: { color: 'purple', text: '待验证' },
  closed: { color: 'green', text: '已关闭' },
  accepted: { color: 'cyan', text: '已接受' },
  cancelled: { color: 'default', text: '已取消' },
};

export const REMEDIATION_STATUS: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  not_started: { color: 'orange', text: '待开始' },
  in_progress: { color: 'processing', text: '整改中' },
  pending_verification: { color: 'purple', text: '待验证' },
  completed: { color: 'green', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
};

export const VERIFICATION_STATUS: Record<string, string> = {
  pending: '待验证', approved: '已通过', rejected: '已驳回', not_required: '无需验证',
};

export const TREATMENT_STRATEGY: Record<string, string> = {
  mitigate: '降低', accept: '接受', avoid: '规避', transfer: '转移',
};
