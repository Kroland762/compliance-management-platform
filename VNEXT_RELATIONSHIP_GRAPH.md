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
2. 创建评估草稿，保存名称、周期和稳定归属部门。
3. 选择资产范围。流程类控制项使用不可归档的 `ORG-GOVERNANCE` 逻辑资产。
4. 配置控制项资产矩阵，并为每个组合选择责任部门和责任人。
5. 发布评估。服务端事务性生成评估单元，重复发布不重复生成。
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

计划执行前重新验证资产。资产已归档或不存在时，执行记录进入 `requires_attention`，
不会猜测替换资产，也不会生成不完整评估。

## 数据库迁移

| 迁移 | 内容 |
|---|---|
| `005_assessment_asset_graph` | 资产、评估范围、矩阵和评估单元字段 |
| `006_risk_remediation_graph` | 风险来源、受影响资产、行动、关联复核、证据父键和编号序列 |
| `007_assessment_plans` | 周期计划和幂等执行记录 |
| `008_relationship_graph_finalize` | 完整性预检、非空/父键约束、关闭旧单关系字段 |

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

集成测试覆盖 2×2 控制项资产矩阵、发布幂等、多来源/多资产风险、一个行动关联两个风险、
逐关联复核、风险关闭门禁、周期计划幂等和资产归档后的 `requires_attention`。
