import sequelize from '../config/database';

/**
 * 生产环境索引迁移（安全操作：IF NOT EXISTS）
 */
async function migrateIndexes() {
  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');

    // 账户审计 - 问题去重查询
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_problems_account_rule_status
        ON account_problems ("accountId", "ruleId", "status");
    `);
    console.log('  ✓ idx_problems_account_rule_status');

    // 账户数据 - 按数据源和层级查询
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_account_data_source_tier
        ON account_data ("sourceId", "dataTier");
    `);
    console.log('  ✓ idx_account_data_source_tier');

    // 任务执行 - 按任务ID和状态
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_executions_task_status
        ON account_task_executions ("taskId", "status");
    `);
    console.log('  ✓ idx_executions_task_status');

    // 审计任务 - 按状态
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_tasks_status
        ON account_audit_tasks ("status");
    `);
    console.log('  ✓ idx_audit_tasks_status');

    // 问题 - 按批次ID（执行结果追踪）
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_problems_batch
        ON account_problems ("auditBatchId");
    `);
    console.log('  ✓ idx_problems_batch');

    console.log('✅ 生产索引迁移完成');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ 索引迁移失败:', error);
    process.exit(1);
  }
}

migrateIndexes();
