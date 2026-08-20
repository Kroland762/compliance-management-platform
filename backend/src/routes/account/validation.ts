import Joi from 'joi';
import { DataSourceStatus, DataSourceType } from '../../models/account/DataSource';
import { RuleType, Severity } from '../../models/account/AuditRule';
import { ScheduleType, TaskStatus } from '../../models/account/AuditTask';
import { ProblemStatus } from '../../models/account/ProblemAccount';

const pagination = {
  page: Joi.number().integer().min(1),
  pageSize: Joi.number().integer().min(1).max(100),
};

export const dataSourceListQuery = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(255),
  sourceType: Joi.string().valid(...Object.values(DataSourceType)),
  status: Joi.string().valid(...Object.values(DataSourceStatus)),
});

export const ruleListQuery = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(255),
  ruleType: Joi.string().valid(...Object.values(RuleType)),
  severity: Joi.string().valid(...Object.values(Severity)),
  isActive: Joi.boolean(),
});

export const taskListQuery = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(255),
  status: Joi.string().valid(...Object.values(TaskStatus)),
  scheduleType: Joi.string().valid(...Object.values(ScheduleType)),
});

export const problemListQuery = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(255),
  taskId: Joi.string().uuid(),
  ruleId: Joi.string().uuid(),
  status: Joi.string().valid(...Object.values(ProblemStatus)),
  severity: Joi.string().valid(...Object.values(Severity)),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
});

export const problemStatusBody = Joi.object({
  status: Joi.string().valid(...Object.values(ProblemStatus)).required(),
  notes: Joi.string().trim().max(2_000).allow(''),
});

export const problemBulkStatusBody = Joi.object({
  ids: Joi.array().items(Joi.string().uuid()).min(1).max(500).required(),
  status: Joi.string().valid(...Object.values(ProblemStatus)).required(),
  notes: Joi.string().trim().max(2_000).allow(''),
});

export const taskExecutionQuery = Joi.object(pagination);
