const schemaPattern = /^tenant_[a-z0-9_]+$/;

async function cleanupIntegrationState({ sequelize, tenants, userIds = [], usernames = [] }) {
  const scheduler = require('../../src/services/account/cronScheduler.service').default;
  scheduler.shutdown();

  const tenantItems = tenants.filter(Boolean);
  for (const tenant of tenantItems) {
    if (!schemaPattern.test(tenant.schemaName)) {
      throw new Error(`Refusing to clean unsafe integration schema: ${tenant.schemaName}`);
    }
    const quote = `"${tenant.schemaName}"`;
    await sequelize.query(
      'DELETE FROM public.task_schedules WHERE "tenantId" = :tenantId OR "tenantSchema" = :schema',
      { replacements: { tenantId: tenant.id, schema: tenant.schemaName } },
    );
    await sequelize.query(`DROP SCHEMA IF EXISTS ${quote} CASCADE`);
    await sequelize.query('DELETE FROM public.schema_migrations WHERE schema_name = :schema', {
      replacements: { schema: tenant.schemaName },
    });
    await sequelize.query('DELETE FROM public.tenants WHERE id = :tenantId', {
      replacements: { tenantId: tenant.id },
    });
  }

  const identities = [...new Set(userIds.filter(Boolean))];
  if (identities.length) {
    await sequelize.query('DELETE FROM public.auth_sessions WHERE "userId" IN (:userIds)', {
      replacements: { userIds: identities },
    });
    await sequelize.query('DELETE FROM public.users WHERE id IN (:userIds)', {
      replacements: { userIds: identities },
    });
  }
  const names = [...new Set(usernames.filter(Boolean))];
  if (names.length) {
    await sequelize.query('DELETE FROM public.auth_sessions WHERE "userId" IN (SELECT id FROM public.users WHERE username IN (:usernames))', {
      replacements: { usernames: names },
    });
    await sequelize.query('DELETE FROM public.users WHERE username IN (:usernames)', {
      replacements: { usernames: names },
    });
  }
}

module.exports = { cleanupIntegrationState };
