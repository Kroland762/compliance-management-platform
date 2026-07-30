# Compliance Management Platform

企业合规审计管理平台，基于 B/S 架构，涵盖**资质合规**与**账户审计**两大模块，支持 schema 级租户隔离、RBAC 权限体系、PostgreSQL 只读数据源和规则引擎自动化审计。

## 功能模块

### 资质合规
- 问卷模版管理（CSV 导入/导出、版本管理）
- 资产台账与组织级治理逻辑资产
- 标准 → 资产范围 → 控制项资产矩阵 → 发布评估
- 一个控制项可评估多个资产，每个组合生成独立“评估单元”
- 风险可关联多个来源评估单元和多个受影响资产
- 一个整改行动可关联多个风险，并在每个风险下独立复核
- 风险关闭由服务端门禁计算，支持单人自审标识
- 周期评估计划保存标准、资产范围和矩阵快照
- 管理驾驶舱与风险/来源/资产/行动/复核/证据多工作表导出

### 账户审计
- PostgreSQL 只读数据源接入（表/字段白名单映射，不接受任意 SQL）
- 账户数据 3 层生命周期（HOT → WARM → COLD）
- 内置规则引擎 + 自定义规则（AND/OR 嵌套条件，10+ 运算符）
- 定时/手动执行审计任务，自动匹配规则并生成问题
- 智能去重：跨任务 `accountId + ruleId` 唯一，已消失问题自动关闭
- 可视化概览（统计卡片、风险分布、问题排行、趋势图）

### 安全体系
- **成员与 RBAC**：全局登录身份 + 租户成员，多角色权限并集，资源 × 操作 × 数据范围矩阵
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
| 调度 | PostgreSQL 持久化租约 + node-cron 触发 |

支持基线：Node.js 22、PostgreSQL 14+。生产数据只允许通过版本化迁移器变更。

## 快速开始

```bash
# 1. 安装依赖
cd backend && npm ci
cd ../frontend && npm ci

# 2. 配置环境变量
cp backend/.env.example backend/.env
# 编辑 .env 填写数据库连接信息

# 3. 初始化数据库
cd backend
npm run migrate:up
SEED_ADMIN_PASSWORD='replace-with-strong-password' npm run seed

# 4. 启动服务
# 终端 1: 后端
cd backend && npm run dev
# 终端 2: 前端
cd frontend && npm run dev
```

访问 http://localhost:5173。系统不再内置固定默认密码；控制面管理员仅在显式设置
`SEED_ADMIN_PASSWORD` 时创建。全局管理员和多租户成员通过租户选择页签发租户态令牌；
没有租户上下文时，业务 API 不接受请求。

## 迁移与验证

```bash
cd backend
npm run migrate:status
npm run migrate:up
npm run migrate:legacy-public          # 默认只生成 public 存量清单
npm run migrate:legacy-public -- --apply --tenant=<tenant-id>
npm run migrate:legacy-files -- --tenant=<tenant-id>  # 默认只生成文件清单
npm run migrate:membership-plan       # 只读生成成员/角色/部门/对象归属清单
npm run migrate:membership-plan -- --apply --mapping=/absolute/path/membership-map.json
npm run migrate:relationship-plan   # 只读生成资产、风险来源和旧整改清单
npm run migrate:relationship-plan -- --apply --mapping=/absolute/path/relationship-map.json

npm test
cd ../frontend && npm test && npm run build
```

迁移记录以 `(migration_id, schema_name)` 为主键并校验迁移内容；迁移器使用 PostgreSQL
advisory lock 防止并发执行。`migrate:down` 只允许对最后一个迁移进行显式确认回滚。

运维、升级、备份恢复和故障排查见 [部署与升级指南](./部署与升级指南.md)。

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

## 身份、成员与权限体系

`public.users` 只保存用户名、密码哈希和认证状态。同一身份可通过不同的
`tenant_members` 加入多个租户，并在每个租户拥有独立的姓名、状态、主/兼职部门和多个角色。
任务、证据、通知与审计人仍引用稳定的全局 User ID。

租户内置 3 个锁定角色。系统角色不可编辑或删除；管理员应先复制为自定义角色，再配置权限。
多角色权限按资源/操作取并集，数据范围按
`all > department_tree > department > assigned > self` 选择最宽范围：

| 资源 | 可选操作 |
|------|---------|
| 成员管理 | 创建、查看、更新、删除 |
| 模版管理 | 创建、查看、更新、删除 |
| 资产台账 | 创建、查看、更新、归档 |
| 合规任务 | 创建、查看、更新、删除、提交、退回、发布、取消 |
| 评估单元 | 查看、填写、提交、复核 |
| 风险管理 | 创建、查看、更新、确认、分配、接受、复核、关闭、导出 |
| 整改行动 | 创建、查看、更新、提交、复核、关联 |
| 周期计划 | 创建、查看、更新、删除、执行 |
| 操作日志 | 查看、导出 |
| 通知管理 | 查看、更新 |
| 数据导出 | 创建 |
| 安全设置 | 查看、更新 |
| 数据源管理 | 创建、查看、更新、删除、同步 |
| 规则管理 | 创建、查看、更新、删除、启停 |
| 审计任务 | 创建、查看、更新、删除、执行 |
| 问题管理 | 查看、更新、导出 |
| 审计概览 | 查看 |

新本地成员由服务端生成一次性临时密码，成功响应只显示一次，首次登录必须改密。已有登录身份
通过 72 小时、单次使用、数据库只存 SHA-256 哈希的邀请令牌加入其他租户。每个有效成员必须
有且只有一个主部门，并至少绑定一个有效角色。

## 规则引擎

支持 AND/OR 嵌套条件逻辑，内置运算符：

`eq` `neq` `gt` `lt` `gte` `lte` `contains` `contains_any` `not_true` `is_null` `is_not_null` `lt_days` `lt_date`

内置规则：长期未登录、未启用 MFA、高权限未启用 MFA、异常创建时间。

vNext 关系图的数据库结构、状态机、接口与运行约束见
[vNext 多对多评估与整改技术说明](./VNEXT_RELATIONSHIP_GRAPH.md)。
