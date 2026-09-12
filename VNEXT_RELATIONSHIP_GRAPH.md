# vNext 多对多评估与整改技术说明

## 目标与边界

本版本保留资质、成员、角色、组织和账户审计模块。账户审计仍使用自己的数据源、规则、
任务和问题闭环，不与风险关系图互转。本期关系图只覆盖标准评估、风险和整改。

核心关系如下：

```text
标准控制项 ─┬─ 评估单元 ─┬─ 风险来源 ─┐
            │            │            ├─ 风险 ─ 风险行动关联 ─ 整改行动
资产 ───────┘            └─ 证据      │                       └─ 证据
资产 ───────────────────── 受影响资产 ┘
```

- `question_items` 保留物理表名和历史 ID，代码与界面称为 `ControlEvaluation`（评估单元）。
- 评估单元唯一键为 `(taskId, templateQuestionId, assetId)`。
- 风险至少有一个 `risk_sources` 和一个 `risk_affected_assets`。
- `risk_action_links` 保存必要性、逐风险复核结论和 `selfReview`。
- 证据父对象必须且只能是评估单元或整改行动之一。

## 评估工作流

1. 导入并选择一个标准版本。
2. 创建“准备中”评估项目，保存名称、周期和稳定归属部门。
3. 选择真实的评估对象与资产范围。组织或流程类控制项应关联其实际覆盖的业务或管理对象，系统不再注入虚拟逻辑资产。
4. 配置控制项资产矩阵，并为每个组合选择责任部门和责任人。
5. 发布评估。服务端事务性生成评估单元，重复发布不重复生成；矩阵允许显式排除不适用组合，
   因此发布数量以启用组合数为准，不强制生成完整笛卡尔积。
6. 责任人逐单元填写现状和上传证据，再提交复核。
7. 审计员逐单元确认符合性或退回。风险不会在复核时自动生成。

评估单元状态：

```text
pending -> in_progress -> submitted -> reviewed
                        \-> returned -> in_progress
```

## 风险与整改工作流

风险创建时显式选择一个或多个已复核评估单元，以及一个或多个受影响资产。风险先进入
`pending_confirmation`，确认后进入 `open`。风险接受必须填写原因和复查日期。
只有复核结论为“部分符合”或“不符合”的评估单元可以作为风险来源。任务完成复核前，
服务端会核对每个此类评估单元都至少映射到一个风险，避免缺陷被漏记。

整改以行动为主对象。一个行动可以服务多个风险，但每条 `risk_action_links` 独立保存：

- 是否为关闭风险所必需；
- 对该风险的整改贡献；
- `pending / approved / rejected` 复核结论；
- 复核人、时间、意见和单人自审标识。

行动上传证据后才能提交。所有必要风险关联通过后，行动才变为 `completed`。风险关闭接口
会再次从数据库计算门禁：至少存在一个必要行动，且每个必要行动已完成、对应关联已通过。
客户端不能直接写入风险关闭状态。

## 周期计划与调度

`assessment_plans` 保存标准版本、资产范围和矩阵 JSON 快照。控制面的
`public.task_schedules` 使用 `resourceType + resourceId` 同时调度账户审计和周期评估。
执行器使用数据库租约、`FOR UPDATE SKIP LOCKED`、heartbeat、超时、指数退避和幂等键。
同一计划并发触发时只保留一个执行结果。计划执行只创建已复制范围和矩阵的“准备中”项目，
由人员检查责任人与资产状态后手工发布，不在后台静默发布评估。

计划执行前重新验证资产。资产已归档或不存在时，执行记录进入 `requires_attention`，
不会猜测替换资产，也不会生成不完整评估。

风险接受后的复查日期复用同一持久化调度器。到期后只发送一次系统内提醒并关闭该次调度，
不会自动改变风险状态。

## 数据库迁移

| 迁移 | 内容 |
|---|---|
| `005_assessment_asset_graph` | 资产、评估范围、矩阵和评估单元字段 |
| `006_risk_remediation_graph` | 风险来源、受影响资产、行动、关联复核、证据父键和编号序列 |
| `007_assessment_plans` | 周期计划和幂等执行记录 |
| `008_relationship_graph_finalize` | 完整性预检、非空/父键约束、关闭旧单关系字段 |
| `009_relationship_graph_hardening` | 命令幂等记录、结构化审计、无任务通知和长文本现状字段 |

升级存量库前先执行：

```bash
cd backend
npm run migrate:relationship-plan
```

该命令只输出清单和 SHA-256 摘要。只有提供经过人工确认的映射文件时才写入：

```bash
npm run migrate:relationship-plan -- --apply --mapping=/absolute/path/relationship-map.json
```

缺少任务资产、风险来源或受影响资产映射时事务中止，不按文本猜测归属。验收结束前保留
`relationship_migration_snapshots`。

## API 概览

- 资产：`/api/assets`
- 范围、矩阵、发布：`/api/tasks/:id/assets`、
  `/api/tasks/:id/control-asset-matrix`、`/api/tasks/:id/publish`
- 评估单元：`/api/tasks/:id/evaluations`、`/api/evaluations/:id/*`
- 风险：`/api/risks/:id/sources|assets|confirm|accept|close`
- 整改：`/api/remediation-actions`、`/api/remediation-actions/:id/risks|evidence|submit`
- 逐风险复核：`/api/risks/:riskId/actions/:actionId/verify`
- 周期计划：`/api/assessment-plans`、`/api/assessment-plans/:id/trigger`

所有详情与关系 ID 都在当前租户上下文解析。跨租户或超出数据范围的对象统一返回 404。

### 并发与重试契约

- 风险创建、整改提交和风险导出必须携带 `Idempotency-Key`。相同键与相同请求会重放原结果；
  相同键配不同请求返回 `409 CONFLICT`。
- 评估单元写入、风险关系/状态写入和整改行动写入必须携带
  `If-Match: "<lockVersion>"`（兼容请求体 `lockVersion`）。缺失返回 428，版本过期返回 409。
- 关系替换、提交、复核、确认、接受和关闭均在数据库事务中锁定主对象；审计记录与业务变更
  同事务提交。
- 风险与整改导出生成后写入租户隔离的 `FileStorage`，幂等重试直接读取已生成文件。
- 旧 `/questions/:id/answer`、`/review/questions/:id`、整任务提交/退回和旧配置写入口返回
  `410 LEGACY_WRITE_PATH_DISABLED`；旧查询与证据读取仍保留，避免存在绕过新状态机的写旁路。

### 审计与可观测性

风险关系变更、状态转换、整改提交/复核、证据上传/下载/删除和周期执行都会记录结构化审计。
字段包括 `eventType`、`requestId`、`memberId`、关联资源、结果、原因码、耗时和部门快照；
日志中不记录令牌、密码、文件内容或问卷原文。

## 验证

支持基线为 Node.js 22 和 PostgreSQL 14+，CI 使用 PostgreSQL 16。发布前至少执行：

```bash
cd backend
npm ci
npm run build
npm test
RUN_PG_INTEGRATION=true npm test
npm run migrate:status

cd ../frontend
npm ci
npm test
npm run build
```

集成和端到端测试覆盖 2×3 候选矩阵中启用 4 个稀疏组合、发布幂等、多来源/多资产风险、
一个行动关联两个风险、驳回后补证重提、逐关联复核、风险关闭门禁、周期计划并发幂等、
计划只生成草稿、资产归档后的 `requires_attention`，以及账户审计 CSV 回归。

性能脚本只能在显式确认的临时数据库运行：

```bash
BENCHMARK_CONFIRM=temporary-only npm run benchmark:vnext
```

门禁为 10 万评估单元普通列表 P95 < 500ms、驾驶舱 P95 < 1s，以及 1 万评估单元发布
< 60s。
