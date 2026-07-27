import { OperationType } from '../models';
import ControlAuditEvent from '../models/ControlAuditEvent';
import Tenant from '../models/Tenant';
import { runWithTenantContext } from '../middlewares/tenant';
import auditLogService from './audit-log.service';

interface AuthAuditEvent {
  operationType: OperationType.LOGIN | OperationType.LOGOUT;
  userId: string | null;
  tenantId?: string | null;
  success: boolean;
  details: string;
  ipAddress?: string;
  requestId?: string;
}

class AuthAuditService {
  async record(event: AuthAuditEvent): Promise<void> {
    if (event.userId && event.tenantId) {
      const tenant = await Tenant.findByPk(event.tenantId);
      if (tenant) {
        await runWithTenantContext(
          { schema: tenant.schemaName, tenantId: tenant.id },
          () => auditLogService.log({
            userId: event.userId!,
            operationType: event.operationType,
            resourceType: 'session',
            resourceId: event.userId,
            operationDetails: event.details,
            success: event.success,
            ipAddress: event.ipAddress,
            tenantId: tenant.id,
          }),
        );
        return;
      }
    }

    await ControlAuditEvent.create({
      eventType: `auth.${event.operationType}`,
      actorUserId: event.userId,
      tenantId: event.tenantId || null,
      resourceType: 'session',
      resourceId: event.userId,
      outcome: event.success ? 'success' : 'failure',
      details: {
        description: event.details,
        ...(event.ipAddress ? { ipAddress: event.ipAddress } : {}),
      },
      requestId: event.requestId || null,
    });
  }
}

export default new AuthAuditService();
