import sequelize from './database';
import { setupAssociations } from '../models/associations';
import '../models';
import '../models/account';
import '../models/account/associations';
import { migrateDown, migrateUp, status } from './migrations/runner';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  setupAssociations();
  await sequelize.authenticate();
  const command = process.argv[2] || 'up';
  if (command === 'status') {
    console.table(await status());
  } else if (command === 'up') {
    await migrateUp();
    console.log('✅ 所有待执行迁移已完成');
  } else if (command === 'down') {
    const schema = option('schema');
    const confirm = option('confirm');
    if (!schema || !confirm) throw new Error('migrate:down 需要 --schema=<schema> --confirm=<migration_id>');
    await migrateDown(schema, confirm);
    console.log(`✅ ${schema} 已回滚 ${confirm}`);
  } else {
    throw new Error(`未知迁移命令: ${command}`);
  }
}

main()
  .catch((error) => {
    console.error('❌ 数据库迁移失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
