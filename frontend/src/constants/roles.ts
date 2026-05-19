// ========================================
// 角色权限常量 — 路由/功能共用
// ========================================

export const ADMIN = 'administrator' as const;
export const AUDITOR = 'auditor' as const;
export const USER = 'user' as const;

/** 仅管理员 */
export const ROLES_ADMIN = [ADMIN] as const;
/** 管理员 + 审计员 */
export const ROLES_ADMIN_AUDITOR = [ADMIN, AUDITOR] as const;
/** 所有角色 */
export const ROLES_ALL = [ADMIN, AUDITOR, USER] as const;
