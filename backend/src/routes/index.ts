import { Application } from 'express';
import authRoutes from './auth.routes';
import memberRoutes from './member.routes';
import templateRoutes from './template.routes';
import taskRoutes from './task.routes';
import questionnaireRoutes from './questionnaire.routes';
import reviewRoutes from './review.routes';
import riskRoutes from './risk.routes';
import notificationRoutes from './notification.routes';
import auditLogRoutes from './audit-log.routes';
import profileRoutes from './profile.routes';
import lookupRoutes from './lookup.routes';
import exportRoutes from './export.routes';
import statsRoutes from './stats.routes';
import accountRoutes from './account';
import settingsRoutes from './settings.routes';
import roleRoutes from './role.routes';
import tenantRoutes from './tenant.routes';
import departmentRoutes from './department.routes';
import qualificationRoutes from './qualification.routes';
import assetRoutes from './asset.routes';
import assessmentScopeRoutes from './assessment-scope.routes';
import evaluationRoutes from './evaluation.routes';
import remediationRoutes from './remediation.routes';
import assessmentPlanRoutes from './assessment-plan.routes';
import { authenticate } from '../middlewares/auth';
import { requireTenantContext } from '../middlewares/tenant';

export function registerRoutes(app: Application): void {
  app.use('/api/auth', authRoutes);
  app.use('/api/tenants', tenantRoutes);

  // 除认证和租户控制面外，所有业务 API 都必须在已认证租户上下文中运行。
  app.use('/api', authenticate, requireTenantContext);
  app.use('/api/members', memberRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/tasks', assessmentScopeRoutes);
  app.use('/api/evaluations', evaluationRoutes);
  app.use('/api/remediation-actions', remediationRoutes);
  app.use('/api/assessment-plans', assessmentPlanRoutes);
  app.use('/api', questionnaireRoutes);
  app.use('/api/review', reviewRoutes);
  app.use('/api/risks', riskRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/audit-logs', auditLogRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/lookup', lookupRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/roles', roleRoutes);
  app.use('/api/departments', departmentRoutes);
  app.use('/api/qualifications', qualificationRoutes);
  app.use('/api/assets', assetRoutes);
}
