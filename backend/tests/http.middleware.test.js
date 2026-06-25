import Joi from 'joi';
import { describe, expect, test, vi } from 'vitest';
import { validate } from '../src/middlewares/validate';
import { errorHandler, notFoundHandler } from '../src/middlewares/errorHandler';
import { AppError, asyncHandler } from '../src/utils/http';

const jest = vi;

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(payload) {
      this.body = payload;
      return this;
    }),
  };
}

describe('P1 http middleware foundation', () => {
  test('validate writes normalized values and strips unknown fields', () => {
    const req = { body: { page: '2', extra: 'drop-me' } };
    const next = jest.fn();

    validate({ body: Joi.object({ page: Joi.number().integer().required() }) })(req, createResponse(), next);

    expect(req.body).toEqual({ page: 2 });
    expect(next).toHaveBeenCalledWith();
  });

  test('validate forwards AppError with validation details', () => {
    const req = { body: { page: 'not-a-number' } };
    const next = jest.fn();

    validate({ body: Joi.object({ page: Joi.number().integer().required() }) })(req, createResponse(), next);

    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details[0].field).toBe('page');
  });

  test('errorHandler formats AppError responses consistently', () => {
    const res = createResponse();
    const err = new AppError(403, 'FORBIDDEN', '拒绝访问', [{ field: 'role' }]);

    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '拒绝访问', details: [{ field: 'role' }] },
    });
  });

  test('notFoundHandler returns a consistent 404 payload', () => {
    const res = createResponse();
    notFoundHandler({ method: 'GET', originalUrl: '/api/missing' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('GET /api/missing');
  });

  test('asyncHandler forwards rejected errors to next', async () => {
    const error = new Error('boom');
    const next = jest.fn();
    const handler = asyncHandler(async () => { throw error; });

    handler({}, createResponse(), next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(error);
  });
});
