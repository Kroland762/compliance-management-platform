import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config';
import sequelize from './config/database';
import { setupAssociations } from './models/associations';
import './models/account/associations'; // 账户审计模块关联
import './models';
import cronSchedulerService from './services/account/cronScheduler.service';
import { tenantContext, registerTenantModel } from './middlewares/tenant';

const app = express();

// 中间件
if (config.nodeEnv === 'production') {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
} else {
  app.use(helmet());
}
app.use(cookieParser());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 建立模型关联（必须在路由注册之前）
setupAssociations();

// 路由
import { registerRoutes } from './routes';

// 健康检查
app.get('/api/health', async (_req, res) => {
  try {
    await sequelize.authenticate();
    const mem = process.memoryUsage();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
      },
      db: 'connected',
      nodeEnv: config.nodeEnv,
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

// 注册租户感知模型
import User from './models/User';
import Role from './models/Role';
import SystemSetting from './models/SystemSetting';
import AccountData from './models/account/AccountData';
import AuditRule from './models/account/AuditRule';
import ProblemAccount from './models/account/ProblemAccount';
import TaskExecution from './models/account/TaskExecution';
import AuditLog from './models/AuditLog';
import Notification from './models/Notification';

for (const model of [User, Role, SystemSetting, AccountData, AuditRule, ProblemAccount, TaskExecution, AuditLog, Notification]) {
  registerTenantModel(model as any);
}

// 租户上下文中间件（在 authenticate 之后，路由处理之前）
app.use(tenantContext);

// 注册所有路由
registerRoutes(app);

// 启动服务器
const start = async () => {
  try {
    // 生产环境密钥检查
    if (config.nodeEnv === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
      throw new Error('❌ 生产环境必须设置 JWT_SECRET 环境变量（至少32字符）');
    }

    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');

    // 初始化定时任务调度器
    await cronSchedulerService.initialize();

    const server = app.listen(config.port, () => {
      console.log(`🚀 服务器运行在 http://localhost:${config.port}`);
    });

    // 优雅关闭
    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down...');
      cronSchedulerService.shutdown();
      server.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      console.log('SIGINT received. Shutting down...');
      cronSchedulerService.shutdown();
      server.close(() => process.exit(0));
    });
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    process.exit(1);
  }
};

start();

export default app;
