# Compliance Management Platform

企业合规审计管理平台，基于 B/S 架构，涵盖**资质合规**与**账户审计**两大模块，支持 RBAC 权限体系、多数据源接入、规则引擎自动化审计。

## 功能模块

### 资质合规
- 问卷模版管理（CSV 导入/导出、版本管理）
- 审计任务创建 → 题目配置 → 指派 → 填写 → 审阅 → 退回/通过
- 风险项追踪与状态管理
- 可视化仪表盘（任务分布、风险分布饼图）

### 账户审计
- 多数据源接入（数据库直连 / CSV 上传，支持字段映射）
- 账户数据 3 层生命周期（HOT → WARM → COLD）
- 内置规则引擎 + 自定义规则（AND/OR 嵌套条件，10+ 运算符）
- 定时/手动执行审计任务，自动匹配规则并生成问题
- 智能去重：跨任务 `accountId + ruleId` 唯一，已消失问题自动关闭
- 可视化概览（统计卡片、风险分布、问题排行、趋势图）

### 安全体系
- **RBAC 权限系统**：自定义角色 + 13 个资源 × 多操作权限矩阵
- **登录安全**：图形验证码、失败锁定（次数/时长可配）、密码复杂度强制（8 位 + 大小写 + 数字 + 特殊字符）
- **会话管理**：JWT Access/Refresh Token + 空闲超时自动登出（可配）
- **审计日志**：全操作留痕

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Ant Design 5 + Vite + Recharts + Zustand |
| 后端 | Node.js + Express + TypeScript + Sequelize ORM |
| 数据库 | PostgreSQL |
| 认证 | JWT (access + refresh) + bcrypt + SVG 验证码 |
| 调度 | node-cron（定时审计任务） |

## 快速开始

```bash
# 1. 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 2. 配置环境变量
cp backend/.env.example backend/.env
# 编辑 .env 填写数据库连接信息

# 3. 初始化数据库
cd backend && npm run migrate && npm run seed

# 4. 启动服务
# 终端 1: 后端
cd backend && npm run dev
# 终端 2: 前端
cd frontend && npm run dev
```

访问 http://localhost:5173 ，默认账号：
- admin / Admin1234（管理员）
- auditor / Auditor1234（审计员）
- respondent / Respondent1234（普通用户）

## 项目结构

```
compliance-management-platform/
├── backend/
│   ├── src/
│   │   ├── config/        # 数据库配置、迁移、种子数据
│   │   ├── middlewares/    # 认证、权限、限流中间件
│   │   ├── models/         # Sequelize 模型
│   │   │   └── account/   # 账户审计模块模型
│   │   ├── routes/         # Express 路由
│   │   │   └── account/   # 账户审计模块路由
│   │   ├── services/       # 业务逻辑
│   │   │   └── account/   # 账户审计模块服务
│   │   └── utils/          # 工具函数（加密、密码校验）
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/            # API 客户端
│   │   ├── components/     # 通用组件（布局、路由守卫）
│   │   ├── hooks/          # 自定义 Hooks（空闲超时等）
│   │   ├── store/          # 状态管理（Zustand）
│   │   ├── views/          # 页面组件
│   │   │   ├── account/   # 账户审计页面
│   │   │   ├── admin/     # 管理页面
│   │   │   └── auditor/   # 审计员页面
│   │   └── utils/          # 前端工具函数
│   └── package.json
└── README.md
```

## 权限体系

系统内置 3 个角色，管理员可自由创建自定义角色并配置权限矩阵：

| 资源 | 可选操作 |
|------|---------|
| 用户管理 | 创建、查看、更新、删除 |
| 模版管理 | 创建、查看、更新、删除 |
| 合规任务 | 创建、查看、更新、删除、提交、退回 |
| 风险管理 | 查看、更新 |
| 操作日志 | 查看、导出 |
| 通知管理 | 查看、更新 |
| 数据导出 | 创建 |
| 安全设置 | 查看、更新 |
| 数据源管理 | 创建、查看、更新、删除、同步 |
| 规则管理 | 创建、查看、更新、删除、启停 |
| 审计任务 | 创建、查看、更新、删除、执行 |
| 问题管理 | 查看、更新、导出 |
| 审计概览 | 查看 |

## 规则引擎

支持 AND/OR 嵌套条件逻辑，内置运算符：

`eq` `neq` `gt` `lt` `gte` `lte` `contains` `contains_any` `not_true` `is_null` `is_not_null` `lt_days` `lt_date`

内置规则：长期未登录、未启用 MFA、高权限未启用 MFA、异常创建时间。
