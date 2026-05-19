import { Op } from 'sequelize';
import { AuditRule, RuleType, Severity, BuiltinKey, AccountData } from '../../models/account';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';

interface ListQuery {
  page?: number;
  pageSize?: number;
  ruleType?: RuleType;
  severity?: Severity;
  isActive?: boolean;
  search?: string;
}

interface CreateRuleInput {
  name: string;
  description?: string;
  severity: Severity;
  conditionLogic: object;
}

interface UpdateRuleInput {
  name?: string;
  description?: string;
  severity?: Severity;
  conditionLogic?: object;
}

type OperatorFn = (value: any, param: any) => boolean;

class RuleEngineService {
  /**
   * 分页列出审计规则
   */
  async listRules(query: ListQuery) {
    const { page = 1, pageSize = 20, ruleType, severity, isActive, search } = query;
    const where: any = {};

    if (ruleType) where.ruleType = ruleType;
    if (severity) where.severity = severity;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }

    const { count, rows } = await AuditRule.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows.map(r => r.toJSON()),
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  /**
   * 获取单条规则
   */
  async getRule(id: string) {
    const rule = await AuditRule.findByPk(id);
    if (!rule) throw new Error('审计规则不存在');
    return rule.toJSON();
  }

  /**
   * 更新内置规则的参数配置
   * 允许修改 paramsConfig（如 { days: 180 }）
   */
  async updateRuleParams(id: string, paramsConfig: object, userId?: string) {
    const rule = await AuditRule.findByPk(id);
    if (!rule) throw new Error('审计规则不存在');

    if (paramsConfig !== undefined && paramsConfig !== null && typeof paramsConfig !== 'object') {
      throw new Error('paramsConfig 必须是一个有效的 JSON 对象');
    }

    await rule.update({ paramsConfig: paramsConfig as any });

    // 如果规则有 builtinKey，根据新参数重新构建 conditionLogic
    if (rule.builtinKey && paramsConfig) {
      const rebuilt = this.buildBuiltinConditionLogic(rule.builtinKey, paramsConfig);
      if (rebuilt) {
        await rule.update({ conditionLogic: rebuilt });
      }
    }

    const reloaded = await rule.reload();

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'rule',
        resourceId: id,
        operationDetails: '修改规则参数',
        success: true,
      });
    }

    return reloaded.toJSON();
  }

  /**
   * 根据 builtinKey 和 paramsConfig 重新构建 conditionLogic
   */
  private buildBuiltinConditionLogic(builtinKey: string, paramsConfig: any): object | null {
    switch (builtinKey) {
      case 'LONG_INACTIVE': {
        const days = paramsConfig.days ?? 180;
        return {
          operator: 'AND',
          conditions: [
            { field: 'lastLoginTime', operator: 'lt_days', value: days },
            { field: 'accountStatus', operator: 'neq', value: 'disabled' },
          ],
        };
      }
      case 'NO_MFA': {
        return {
          operator: 'AND',
          conditions: [
            { field: 'mfaEnabled', operator: 'not_true' },
          ],
        };
      }
      case 'HIGH_PRIV_NO_MFA': {
        return {
          operator: 'AND',
          conditions: [
            { field: 'mfaEnabled', operator: 'not_true' },
            {
              operator: 'OR',
              conditions: [
                { field: 'accountPermission', operator: 'contains_any', value: ['admin', 'root', 'superadmin', 'owner'] },
              ],
            },
          ],
        };
      }
      case 'ABNORMAL_CREATE_TIME': {
        return {
          operator: 'AND',
          conditions: [
            { field: 'createdTime', operator: 'lt_date', value: '2023-01-01' },
            { field: 'lastLoginTime', operator: 'is_not_null' },
          ],
        };
      }
      default:
        return null;
    }
  }

  /**
   * 创建自定义规则
   */
  async createRule(data: CreateRuleInput, userId?: string) {
    if (!data.conditionLogic || typeof data.conditionLogic !== 'object') {
      throw new Error('conditionLogic 必须是一个有效的逻辑表达式对象');
    }

    const rule = await AuditRule.create({
      name: data.name,
      ruleType: RuleType.CUSTOM,
      description: data.description || null,
      severity: data.severity,
      conditionLogic: data.conditionLogic,
      isActive: true,
      builtinKey: null,
      paramsConfig: null,
    } as any);

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.CREATE,
        resourceType: 'rule',
        resourceId: rule.id,
        operationDetails: `创建规则: ${data.name}`,
        success: true,
      });
    }

    return rule.toJSON();
  }

  /**
   * 更新规则（仅自定义规则可更新 conditionLogic）
   */
  async updateRule(id: string, data: UpdateRuleInput, userId?: string) {
    const rule = await AuditRule.findByPk(id);
    if (!rule) throw new Error('审计规则不存在');

    const updates: any = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.severity !== undefined) updates.severity = data.severity;
    if (data.conditionLogic !== undefined) {
      if (rule.ruleType === RuleType.BUILTIN) {
        throw new Error('内置规则的 conditionLogic 不可修改');
      }
      updates.conditionLogic = data.conditionLogic;
    }

    await rule.update(updates);

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'rule',
        resourceId: id,
        operationDetails: `更新规则: ${rule.name}`,
        success: true,
      });
    }

    return rule.toJSON();
  }

  /**
   * 启用/禁用规则
   */
  async toggleRule(id: string, userId?: string) {
    const rule = await AuditRule.findByPk(id);
    if (!rule) throw new Error('审计规则不存在');

    const newActive = !rule.isActive;
    await rule.update({ isActive: newActive });

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'rule',
        resourceId: id,
        operationDetails: newActive ? '启用规则' : '停用规则',
        success: true,
      });
    }

    return { id, isActive: newActive };
  }

  /**
   * 删除规则（仅自定义规则）
   */
  async deleteRule(id: string, userId?: string) {
    const rule = await AuditRule.findByPk(id);
    if (!rule) throw new Error('审计规则不存在');

    if (rule.ruleType === RuleType.BUILTIN) {
      throw new Error('内置规则不可删除');
    }

    await rule.destroy();

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.DELETE,
        resourceType: 'rule',
        resourceId: id,
        operationDetails: `删除规则: ${rule.name}`,
        success: true,
      });
    }
  }

  // ==================== 规则引擎 ====================

  /**
   * 支持的运算符
   */
  private operators: Record<string, OperatorFn> = {
    eq: (v, p) => v == p,
    neq: (v, p) => v != p,
    gt: (v, p) => Number(v) > Number(p),
    lt: (v, p) => Number(v) < Number(p),
    gte: (v, p) => Number(v) >= Number(p),
    lte: (v, p) => Number(v) <= Number(p),

    // contains: 字段值包含指定字符串（不区分大小写）
    contains: (v, p) => {
      if (v == null) return false;
      return String(v).toLowerCase().includes(String(p).toLowerCase());
    },

    // contains_any: 字段值包含任意一个指定值（p 为数组）
    contains_any: (v, p) => {
      if (v == null) return false;
      const arr = Array.isArray(p) ? p : [p];
      return arr.some(item => String(v).toLowerCase().includes(String(item).toLowerCase()));
    },

    // not_true: 字段值为 falsy（false, null, undefined, 0, ''）
    not_true: (v, _p) => !v,

    // is_null: 字段值为 null 或 undefined
    is_null: (v, _p) => v === null || v === undefined,

    // is_not_null: 字段值不为 null 且不为 undefined
    is_not_null: (v, _p) => v !== null && v !== undefined,

    // lt_days: 日期字段距离现在超过 N 天（p 为天数）
    lt_days: (v, p) => {
      if (v == null) return true; // 无数据视为超过任何天数
      const date = v instanceof Date ? v : new Date(v);
      if (isNaN(date.getTime())) return true;
      const diffMs = Date.now() - date.getTime();
      return diffMs > Number(p) * 24 * 60 * 60 * 1000;
    },

    // lt_date: 日期字段早于指定日期（p 为日期字符串）
    lt_date: (v, p) => {
      if (v == null) return true;
      const date = v instanceof Date ? v : new Date(v);
      const target = new Date(p);
      if (isNaN(date.getTime()) || isNaN(target.getTime())) return false;
      return date < target;
    },
  };

  /**
   * 评估单条账户数据是否符合单条规则
   * conditionLogic 支持 AND/OR 嵌套结构：
   * { operator: 'AND', conditions: [...] }
   * { field, operator, value }  叶子节点
   */
  async evaluateRule(accountData: Record<string, any>, rule: { conditionLogic: any; severity?: string }): Promise<{ matched: boolean; details?: string }> {
    try {
      const matched = this.evaluateConditionNode(accountData, rule.conditionLogic);
      return { matched, details: matched ? `触发规则，严重级别: ${rule.severity || 'N/A'}` : undefined };
    } catch (error: any) {
      return { matched: false, details: `评估错误: ${error.message}` };
    }
  }

  /**
   * 递归评估条件节点
   */
  private evaluateConditionNode(accountData: Record<string, any>, node: any): boolean {
    if (!node || typeof node !== 'object') {
      return false;
    }

    // 逻辑组合节点: { operator: 'AND'|'OR', conditions: [...] }
    if (node.operator && node.conditions) {
      const op = node.operator.toUpperCase();
      if (op === 'AND') {
        return node.conditions.every((c: any) => this.evaluateConditionNode(accountData, c));
      }
      if (op === 'OR') {
        return node.conditions.some((c: any) => this.evaluateConditionNode(accountData, c));
      }
      return false;
    }

    // 叶子节点: { field, operator, value?, valueKey?, logic? }
    if (node.field && node.operator) {
      const fieldValue = accountData[node.field];
      const opFn = this.operators[node.operator];

      if (!opFn) {
        throw new Error(`不支持的运算符: ${node.operator}`);
      }

      // 解析参数值：优先 node.value，其次通过 valueKey 从 node 或 node.logic 中查找
      let paramValue = node.value;
      if (paramValue === undefined && node.valueKey) {
        paramValue = node.logic?.[node.valueKey] ?? node[node.valueKey];
      }

      return opFn(fieldValue, paramValue);
    }

    return false;
  }

  /**
   * 批量评估：对给定的账户ID列表和规则ID列表进行交叉评估
   */
  async evaluateBatch(accountIds: string[], ruleIds: string[]) {
    // 查询账户数据
    const accounts = await AccountData.findAll({
      where: { accountId: { [Op.in]: accountIds } },
      attributes: ['id', 'accountId', 'accountName', 'mfaEnabled', 'accountPermission', 'createdTime', 'lastLoginTime', 'accountStatus', 'customFields', 'sourceRawData'],
    });

    // 查询规则
    const rules = await AuditRule.findAll({
      where: { id: { [Op.in]: ruleIds }, isActive: true },
    });

    const results: Array<{
      accountId: string;
      accountDataId: string;
      ruleId: string;
      ruleName: string;
      severity: string;
      matched: boolean;
      description: string;
    }> = [];

    for (const account of accounts) {
      const accData = account.toJSON();

      for (const rule of rules) {
        const { matched, details } = await this.evaluateRule(accData, {
          conditionLogic: rule.conditionLogic,
          severity: rule.severity,
        });

        results.push({
          accountId: accData.accountId,
          accountDataId: accData.id,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          matched,
          description: details || '',
        });
      }
    }

    return results;
  }

  /**
   * 根据规则 keys 加载内置规则的 conditionLogic
   * 这是给 auditTask.service 内部使用的便利方法
   */
  async getBuiltinRuleByKey(builtinKey: string): Promise<AuditRule | null> {
    return AuditRule.findOne({ where: { builtinKey } });
  }

  /**
   * 获取活跃的内置规则列表
   */
  async getActiveBuiltinRules(): Promise<AuditRule[]> {
    return AuditRule.findAll({
      where: { ruleType: RuleType.BUILTIN, isActive: true },
    });
  }
}

export default new RuleEngineService();
