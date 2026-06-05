import Joi from 'joi';

const uuid = Joi.string().uuid({ version: ['uuidv4'] });
const optionalText = Joi.string().trim().max(100).allow('', null);

export const userIdParamsSchema = Joi.object({
  id: uuid.required(),
});

export const listUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  roleId: uuid.optional(),
  tenantId: uuid.optional(),
  isActive: Joi.boolean().optional(),
  keyword: Joi.string().trim().max(100).optional(),
});

export const createUserBodySchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required(),
  password: Joi.string().min(8).max(128).required(),
  department: optionalText.optional(),
  email: Joi.string().trim().email().max(200).allow('', null).optional(),
  roleId: uuid.required(),
});

export const updateUserBodySchema = Joi.object({
  department: optionalText.optional(),
  email: Joi.string().trim().email().max(200).allow('', null).optional(),
  roleId: uuid.optional(),
  isActive: Joi.boolean().optional(),
}).min(1);
