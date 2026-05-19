import sequelize from '../config/database';
import { setupAssociations } from '../models/associations';
import '../models'; // 导入所有模型确保注册
import '../models/account/associations'; // 账户审计模块模型

async function migrate() {
  try {
    // 建立关联
    setupAssociations();

    // 同步所有模型到数据库（开发环境用 alter，生产用 migrate）
    await sequelize.sync({ alter: true });
    console.log('✅ 数据库迁移完成：所有表已创建/更新');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
    process.exit(1);
  }
}

migrate();
