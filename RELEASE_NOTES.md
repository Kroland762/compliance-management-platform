# Release Notes

## 2026-08-04 — Security_compliance 与 Compliance-management-platform 统一

- 以 vNext 多租户、成员权限和关系图为主干，合入原平台的证据在线预览、历史证据迁移、
  对象级授权、数据源安全边界、证据完整性校验和 P0 持久化加固。
- 当前、历史与整改证据使用同一版本化模型，支持图片、PDF、CSV 在线预览，并保留
  SHA-256、扫描状态、替代关系和可审计软删除信息。
- 统一 Vitest、Jest、真实 PostgreSQL 集成测试与 Playwright 端到端门禁；CI 基线为 Node 22。
- 后端生产依赖审计无已知漏洞。React Router 已更新到当前可用的 7.18.2；上游
  `GHSA-qwww-vcr4-c8h2` 仅影响本项目未启用的 unstable RSC API，修复版 8.3.0 尚未发布，
  后续发布后应升级并重新执行前端测试、构建与端到端回归。

## 2026-07-27 — P0/P1/P2 hardening candidate

- `public.users` 收敛为全局登录身份；租户新增 `tenant_members`、`member_roles` 和一次性邀请，
  同一身份可在多个租户拥有不同姓名、状态、部门、角色和权限。
- 登录支持单租户自动进入、多租户选择后签发租户态 Access/Refresh Token；密码、成员状态、
  角色和租户状态变化会撤销旧会话。临时密码账号强制首次改密。
- 部门统一使用稳定 ID，强制唯一主部门并支持兼职；新增不可变 code、负责人、归档状态、
  十级深度和循环保护。任务、资质、风险与审计日志接入稳定部门归属和范围过滤。
- 角色改为多角色权限并集和“资源 × 动作 × 数据范围”；系统角色锁定，只能复制为自定义角色，
  并保护最后一个有效管理员。
- 新增 `migrate:membership-plan`、身份快照和清理前门禁；旧 `/api/users` 及用户 tenant/role/
  department 字段已移除。

- 认证中间件统一创建 AsyncLocalStorage 租户上下文；前端通过上下文接口换取租户态令牌，
  `X-Tenant-ID` 只能与该令牌租户一致，不能单独用于切换租户。
- `public` 收敛为控制面，租户角色、组织、资质、任务、证据和账户审计进入租户 schema。
- 新增带校验和、advisory lock 和按 schema 状态的版本化迁移器，以及受保护的存量复制工具。
- 统一服务端分页和授权范围统计；资质摘要与工作台不再依赖当前页长度。
- 证据改用随机 tenant-scoped storage key、扩展名/MIME/签名校验、SHA-256 和软删除。
- 账户审计数据源支持 PostgreSQL、MySQL、SQL Server、Oracle、SQLite 只读表/字段白名单，阻断元数据及未授权私网地址。
- 新增 live/ready/metrics、Winston JSON 日志、requestId、PostgreSQL 持久化调度租约和幂等执行。
- 新增加密备份/恢复脚本、Vitest/真实 PostgreSQL/Supertest/Playwright 门禁和 Node 22 CI。
- 前端取消 Ant Design 单一大 chunk，保留路由懒加载并将最大 chunk 降至 700 KB 门禁以内。
- 上传中间件升级到 Multer 2；Vite/Vitest 升级到 8/4，React Router 升级到 7.18 系列。

## 2026-07-02

### 新增功能

- 新增组织管理能力，支持部门树维护、同级/子级部门创建、部门信息编辑、成员维护和删除保护。
- 新增组织权限资源 `organization`，可通过角色权限矩阵控制组织数据的查看、创建、更新和删除。
- 新增部门与部门成员数据模型，并接入用户、角色和审计日志关联。

### 安全与权限

- 强化问卷答案和证据文件访问控制：非操作人员只能访问本人被分配的问卷条目和相关证据，历史证据维护仅允许具备任务操作权限的用户执行。
- 账户审计问题列表和概览接口改为显式校验 `problems.read`、`dashboard.read` 权限。
- 个人密码修改统一复用认证服务，继承密码复杂度校验、旧密码校验和 token 版本吊销逻辑。
- 刷新令牌增加 `tokenVersion` 失效校验测试，覆盖旧 refresh token 被拒绝的场景。
- 租户创建流程校验 slug 格式，并对 PostgreSQL schema/table 标识符进行安全引用，避免动态 DDL 注入风险。
- 生产环境拒绝缺失、过短或占位的 `JWT_SECRET`，并拒绝占位 `ENCRYPTION_KEY`。

### 部署与运维

- 数据库 SSL 改为通过 `DB_SSL` 显式控制，避免本地 Docker Compose 的 PostgreSQL 默认非 SSL 配置在 production 模式下连接失败。
- Docker Compose 改为要求运行时注入 `JWT_SECRET` 和 `ENCRYPTION_KEY`，并为本地 Postgres 明确设置 `DB_SSL=false`。
- 迁移和种子脚本补充新模型注册和组织权限初始化。

### 前端体验

- 新增组织管理页面和系统设置导航入口。
- 优化主布局在窄屏下的侧边栏、顶部导航和用户名展示。
- 增加全局响应式样式，改善表格、筛选工具栏、设置表单和账户审计页面在小屏幕下的横向溢出问题。
- 调整账户审计列表、问题、规则、数据源和概览页面的布局密度与移动端可用性。

### 验证

- 后端测试：`npm test`
- 后端构建：`npm run build`
- 前端构建：`npm run build`
# vNext 多对多评估与整改

- 新增资产台账、评估范围和控制项资产矩阵；发布后按控制项 × 资产生成独立评估单元。
- 风险改为多来源、多受影响资产模型，不再从复核服务自动生成。
- 整改行动成为独立主对象，可关联多个风险并逐风险复核；服务端强制风险关闭门禁。
- 新增周期评估计划与通用 PostgreSQL 持久化调度资源。
- 驾驶舱按主对象去重，新增高风险、未整改、逾期行动、评估完成率和月度趋势。
- 风险导出升级为风险、来源、资产、行动、逐风险复核和证据索引多工作表。
- 账户审计、资质、成员、角色和组织模块继续保留；账户审计未接入本期风险关系图。
