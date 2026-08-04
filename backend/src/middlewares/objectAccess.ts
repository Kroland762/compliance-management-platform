import type { NextFunction, Request, Response } from 'express';
import objectAccessService, { ObjectAccessError, type TaskObjectAction } from '../services/object-access.service';

type ObjectKind = 'task' | 'question' | 'evidence';

export function requireObjectAccess(kind: ObjectKind, paramName: string, action: TaskObjectAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } });
      return;
    }

    try {
      const id = req.params[paramName];
      if (kind === 'task') await objectAccessService.assertTaskAccess(id, req.user, action);
      if (kind === 'question') await objectAccessService.assertQuestionAccess(id, req.user, action);
      if (kind === 'evidence') await objectAccessService.assertEvidenceAccess(id, req.user, action);
      next();
    } catch (error) {
      const accessError = error as ObjectAccessError;
      const status = accessError.statusCode || 403;
      res.status(status).json({
        success: false,
        error: { code: accessError.code || 'OBJECT_FORBIDDEN', message: accessError.message || '无权访问该对象' },
      });
    }
  };
}
