// ========================================
// 统一的状态映射 — 所有页面共用
// ========================================

/** 审计员/管理员视角 — 任务列表 */
export const TASK_STATUS: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  configuring: { color: 'cyan', text: '配置中' },
  assigned: { color: 'blue', text: '已分配' },
  in_progress: { color: 'processing', text: '进行中' },
  submitted: { color: 'orange', text: '待审阅' },
  under_review: { color: 'purple', text: '审阅中' },
  completed: { color: 'green', text: '已完成' },
  returned: { color: 'red', text: '已退回' },
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
export const CAN_EDIT_TASK_STATUS = ['assigned', 'in_progress'] as const;

/** 审阅页 — 可审阅状态 */
export const CAN_REVIEW_STATUS = ['submitted', 'under_review'] as const;

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
