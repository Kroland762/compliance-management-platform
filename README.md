# Compliance Management Platform

企业合规审计管理平台，基于 B/S 架构，涵盖**合规评估**、**产品合规**与**账户审计**，支持 schema 级租户隔离、RBAC 权限体系、版本化合规档案、PostgreSQL 只读数据源和规则引擎自动化审计。

## 功能模块

### 合规评估
- 合规标准管理（CSV 导入/导出、版本管理）
- 评估对象与资产台账
- 标准 → 资产范围 → 表格式评估 → 发布复核
- 发布时默认每个控制项生成一行并关联项目全部资产；填写人可在提交前调整关联资产，或把部分资产拆分成新行
- CSV 数据会完整导入，参考回答不再作为显示列；模板管理员可直接在模板表头调整全部业务列和系统列，发布时将完整列配置快照到项目，已有项目可由管理员手动同步模板列配置
- 历史回答与证据按“标准系列 + 稳定控制项标识 + 重叠资产”匹配，首次评估或无匹配记录时明确显示为空
- 评估表支持覆盖全部分页数据的服务端筛选：顶部快捷筛选与表头列筛选保持同步，条件保存在 URL；现状说明仅按已填写/未填写筛选，不检索加密回答正文
- 一个评估项目可配置多名审计员；审计员从共享复核池原子认领评估单元，禁止填写人自审
- 发布时锁定控制项和资产摘要快照，基础台账后续修改或归档不改变历史评估
- 部分符合或不符合的已复核单元自动、唯一生成不符合项
- 不符合项可直接关联整改行动，也可合并升级为风险；两条处置路径互斥
- 一个整改行动可服务多个不符合项或风险，必要关联均验证通过后才完成
- 评估关闭门禁由服务端计算：所有单元复核完成且不符合项解决后才能关闭
- 项目状态统一为“准备中 → 待开始 → 进行中 → 待复核 → 待闭环 → 已关闭”，退回与提交仅作为评估单元状态
- 周期评估计划保存标准、资产范围和矩阵快照
- 当前证据、历史证据和整改证据统一版本化管理，支持图片、PDF、CSV 在线预览
- 证据上传执行类型与文件签名校验、SHA-256 完整性记录；删除采用可审计软删除
- 管理驾驶舱与风险/来源/资产/行动/复核/证据多工作表导出

### 产品合规
- 产品台账与版本时间线，每个产品版本形成独立合规档案
- 按产品类型自动组合版本化问卷，允许填写调整原因后人工增减
- 跨版本按稳定题目标识继承答案，并继承权限、信息类型和 ROPA 为待复核草稿
- 人工维护 Android、iOS、Web 等平台权限及其用途和关联信息类型
- 使用“信息类型清单 + 处理活动”两层结构记录 GDPR ROPA
- 档案流程状态与合规结论分离；产品负责人提交，合规人员复核确认
- 已确认档案不可覆盖，纠错通过新修订完成并完整保留审计轨迹
- 计划上线日期已到但档案未确认时提示风险，首期不阻断发布

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
- **对象级授权**：按租户、部门、负责人和分配关系校验数据范围，避免仅依赖前端隐藏
- **数据源边界**：只允许 PostgreSQL、拒绝任意 SQL 与危险标识符，默认阻断内网和云元数据地址
- **审计日志与可靠调度**：全操作留痕；定时任务使用 PostgreSQL 持久化租约，支持进程重启恢复

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

macOS 也可以直接双击项目根目录的 `start-dev.command` 一键启动前后端。脚本会复用已运行的健康服务、检查 PostgreSQL 和端口占用，并将日志写入 `.dev-logs/`；按 `Ctrl+C` 可关闭本次由脚本启动的服务。

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
BENCHMARK_CONFIRM=temporary-only npm run benchmark:vnext  # 仅限临时数据库
RUN_PG_INTEGRATION=true npm run test:ci  # 需要专用临时 PostgreSQL
cd ../frontend && npm run test:ci && npm run build
npm run test:e2e                        # 需要已迁移、已种子化的测试数据库
```

产品合规模块由 `019_control_product_compliance_permissions`、
`019_tenant_product_compliance` 和 `020_tenant_product_compliance_constraints` 启用。生产升级前必须备份；租户内已经产生产品数据后，
安全回滚门禁会拒绝删除相关业务表。

迁移记录以 `(migration_id, schema_name)` 为主键并校验迁移内容；迁移器使用 PostgreSQL
advisory lock 防止并发执行。`migrate:down` 只允许对最后一个迁移进行显式确认回滚。
关系图写接口使用 `If-Match` 乐观锁；评估认领使用行锁防止并发抢占；风险创建、整改提交和风险导出使用持久化
`Idempotency-Key`，以支持安全重试和并发防重。

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
| 合规标准 | 创建、查看、更新、删除 |
| 资产台账 | 创建、查看、更新、归档 |
| 评估项目 | 创建、查看、更新、删除、提交、退回、发布、取消 |
| 评估单元 | 查看、填写、提交、认领、复核 |
| 不符合项 | 查看、分级、整改、升级风险、验证、关闭 |
| 风险管理 | 创建、查看、更新、确认、分配、接受、复核、关闭、导出 |
| 整改行动 | 创建、查看、更新、提交、复核、关联 |
| 周期评估 | 创建、查看、更新、删除、执行 |
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

内置审计员只读取自己被分配的评估项目，可认领、释放和复核单元，并处置不符合项、风险及
整改验证；不具有合规标准、资产台账、资质台账或周期评估权限。项目内只返回发布时保存的
控制项和资产安全摘要。普通成员只填写分配给自己的评估单元并处理本人整改事项。

## 规则引擎

支持 AND/OR 嵌套条件逻辑，内置运算符：

`eq` `neq` `gt` `lt` `gte` `lte` `contains` `contains_any` `not_true` `is_null` `is_not_null` `lt_days` `lt_date`

内置规则：长期未登录、未启用 MFA、高权限未启用 MFA、异常创建时间。

vNext 关系图的数据库结构、状态机、接口与运行约束见
[vNext 多对多评估与整改技术说明](./VNEXT_RELATIONSHIP_GRAPH.md)。
