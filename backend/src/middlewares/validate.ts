import { NextFunction, Request, RequestHandler, Response } from 'express';
import Joi from 'joi';
import { AppError } from '../utils/http';

type RequestPart = 'body' | 'query' | 'params';

type ValidationSchemas = Partial<Record<RequestPart, Joi.ObjectSchema>>;

const validationOptions: Joi.ValidationOptions = {
  abortEarly: false,
  allowUnknown: false,
  stripUnknown: true,
  convert: true,
};

function formatDetails(error: Joi.ValidationError) {
  return error.details.map((detail) => ({
    field: detail.path.join('.'),
    message: detail.message,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const part of Object.keys(schemas) as RequestPart[]) {
      const schema = schemas[part];
      if (!schema) continue;

      const { value, error } = schema.validate(req[part], validationOptions);
      if (error) {
        next(new AppError(400, 'VALIDATION_ERROR', '请求参数校验失败', formatDetails(error)));
        return;
      }

      const target = req[part] as Record<string, unknown>;
      Object.keys(target).forEach((key) => delete target[key]);
      Object.assign(target, value);
    }

    next();
  };
}
