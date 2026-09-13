#!/usr/bin/env -S npx tsx
import { readFileSync } from 'fs';
import { QueryTypes } from 'sequelize';
import sequelize from './database';
import { migrateUp } from './migrations/runner';
import { risksWithoutTask } from './migrations/legacy-risk-compat';
import Tenant from '../models/Tenant';
import {
  AuditTask,
  DepartmentMember,
  MemberRole,
  Qualification,
  RiskRecord,
  TenantMember,
} from '../models';
import { runWithTenantContext } from '../middlewares/tenant';

interface Mapping {
  tenants: Record<string, {
    members?: Record<string, {
      primaryDepartmentId: string;
      additionalDepartmentIds?: string[];
      roleIds?: string[];
    }>;
    tasks?: Record<string, string>;
    qualifications?: Record<string, string>;
    risks?: Record<string, string>;
  }>;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await sequelize.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = :schemaName AND table_name = :tableName
     ) AS exists`,
    { replacements: { schemaName, tableName }, type: QueryTypes.SELECT },
  );
  return Boolean(rows[0]?.exists);
}

async function buildPlan() {
  const tenants = await Tenant.findAll({ order: [['createdAt', 'ASC']] });
  const output: any = { generatedAt: new Date().toISOString(), tenants: {} };
  for (const tenant of tenants) {
    const quoted = `"${tenant.schemaName.replace(/"/g, '""')}"`;
    if (await tableExists(tenant.schemaName, 'tenant_members')) {
      output.tenants[tenant.id] = await runWithTenantContext(
        { schema: tenant.schemaName, tenantId: tenant.id },
        async () => {
          const members = await TenantMember.findAll({ order: [['createdAt', 'ASC']] });
          const unresolvedMembers = [];
          for (const member of members) {
            const [roles, departments] = await Promise.all([
              MemberRole.findAll({ where: { memberId: member.id } }),
              DepartmentMember.findAll({ where: { memberId: member.id } }),
            ]);
            const primary = departments.filter((item) => item.isPrimary);
            if (roles.length === 0 || primary.length !== 1) {
              unresolvedMembers.push({
                memberId: member.id,
                userId: member.userId,
                roleIds: roles.map((item) => item.roleId),
                departmentIds: departments.map((item) => item.departmentId),
                primaryDepartmentIds: primary.map((item) => item.departmentId),
              });
            }
          }
          return {
            schemaName: tenant.schemaName,
            unresolvedMembers,
            tasksWithoutDepartment: await AuditTask.findAll({
              where: { departmentId: null as any },
              attributes: ['id', 'assessmentTarget', 'createdBy', 'assignedTo'],
              raw: true,
            }),
            qualificationsWithoutDepartment: await Qualification.findAll({
              where: { ownerDepartmentId: null as any },
              attributes: ['id', 'name', 'ownerDepartment', 'responsiblePerson'],
              raw: true,
            }),
            risksWithoutTask: await risksWithoutTask(sequelize, tenant.schemaName),
          };
        },
      );
    } else {
      const users = await sequelize.query(
        `SELECT id, username, "roleId", department
         FROM public.users WHERE "tenantId" = :tenantId ORDER BY "createdAt"`,
        { replacements: { tenantId: tenant.id }, type: QueryTypes.SELECT },
      ).catch(() => []);
      const departments = await sequelize.query(
        `SELECT dm."userId", dm."departmentId", d.name
         FROM ${quoted}.department_members dm
         JOIN ${quoted}.departments d ON d.id = dm."departmentId"
         ORDER BY dm."userId", d.name`,
        { type: QueryTypes.SELECT },
      ).catch(() => []);
      output.tenants[tenant.id] = {
        schemaName: tenant.schemaName,
        legacyUsers: users,
        legacyDepartmentMemberships: departments,
        note: '先执行 --apply；结构迁移会在最终门禁处中止，再根据生成的新清单补充映射。',
      };
    }
  }
  return output;
}

async function applyMapping(mapping: Mapping): Promise<void> {
  for (const [tenantId, tenantMapping] of Object.entries(mapping.tenants || {})) {
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) throw new Error(`映射包含不存在的租户: ${tenantId}`);
    await runWithTenantContext(
      { schema: tenant.schemaName, tenantId },
      () => sequelize.transaction(async (transaction) => {
        for (const [userId, memberMapping] of Object.entries(tenantMapping.members || {})) {
          const member = await TenantMember.findOne({ where: { userId }, transaction });
          if (!member) throw new Error(`租户 ${tenantId} 找不到用户 ${userId} 的成员记录`);
          if (memberMapping.roleIds) {
            await MemberRole.destroy({ where: { memberId: member.id }, transaction });
            await MemberRole.bulkCreate(
              memberMapping.roleIds.map((roleId) => ({ memberId: member.id, roleId })),
              { transaction },
            );
          }
          await DepartmentMember.destroy({ where: { memberId: member.id }, transaction });
          await DepartmentMember.bulkCreate([
            {
              memberId: member.id,
              departmentId: memberMapping.primaryDepartmentId,
              isPrimary: true,
            },
            ...(memberMapping.additionalDepartmentIds || []).map((departmentId) => ({
              memberId: member.id,
              departmentId,
              isPrimary: false,
            })),
          ], { transaction });
        }
        for (const [taskId, departmentId] of Object.entries(tenantMapping.tasks || {})) {
          const [count] = await AuditTask.update({ departmentId }, { where: { id: taskId }, transaction });
          if (count !== 1) throw new Error(`租户 ${tenantId} 找不到任务 ${taskId}`);
        }
        for (const [qualificationId, departmentId] of Object.entries(tenantMapping.qualifications || {})) {
          const [count] = await Qualification.update(
            { ownerDepartmentId: departmentId },
            { where: { id: qualificationId }, transaction },
          );
          if (count !== 1) throw new Error(`租户 ${tenantId} 找不到资质 ${qualificationId}`);
        }
        for (const [riskId, taskId] of Object.entries(tenantMapping.risks || {})) {
          const task = await AuditTask.findByPk(taskId, { transaction });
          if (!task) throw new Error(`租户 ${tenantId} 找不到风险 ${riskId} 的目标任务 ${taskId}`);
          const [count] = await RiskRecord.update({ taskId }, { where: { id: riskId }, transaction });
          if (count !== 1) throw new Error(`租户 ${tenantId} 找不到风险 ${riskId}`);
        }
      }),
    );
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (!apply) {
    process.stdout.write(`${JSON.stringify(await buildPlan(), null, 2)}\n`);
    return;
  }
  const mappingPath = argValue('mapping');
  if (!mappingPath) throw new Error('--apply 必须同时提供 --mapping=<json 文件>');
  try {
    await migrateUp();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('成员治理迁移仍有未映射数据')) throw error;
  }
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as Mapping;
  await applyMapping(mapping);
  await migrateUp();
  process.stdout.write(`${JSON.stringify({ ok: true, applied: true }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
