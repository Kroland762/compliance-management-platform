import sequelize from './database';
import { setupAssociations } from '../models/associations';
import '../models/account/associations';
import '../models';
import { migrateP0Abde } from './p0-abde-migration';

async function main(): Promise<void> {
  try {
    setupAssociations();
    await sequelize.authenticate();
    await migrateP0Abde();
    console.log('✅ P0-A/B/D/E 数据库迁移完成');
  } catch (error) {
    console.error('❌ P0-A/B/D/E 数据库迁移失败:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void main();
