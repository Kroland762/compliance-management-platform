import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import qualificationService from '../services/qualification.service';
import objectAccessService from '../services/object-access.service';
import { AppError, asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

router.get('/', authorize('qualifications', 'read'), asyncHandler(async (req, res) => {
  const result = await qualificationService.list(
    req.query as any,
    await objectAccessService.qualificationScope(req.user!, 'read'),
  );
  res.json({ success: true, data: result });
}));

router.post('/', authorize('qualifications', 'create'), asyncHandler(async (req, res) => {
  const ownerDepartmentId = req.body.ownerDepartmentId || req.user!.primaryDepartmentId;
  if (!ownerDepartmentId) throw new AppError(400, 'PRIMARY_DEPARTMENT_REQUIRED', '请选择归属部门');
  const qualification = await qualificationService.create(
    { ...req.body, ownerDepartmentId },
    req.user!.userId,
  );
  res.status(201).json({ success: true, data: qualification });
}));

router.put('/:id', authorize('qualifications', 'update'), asyncHandler(async (req, res) => {
  await objectAccessService.qualificationOrNotFound(req.params.id, req.user!, 'update');
  const qualification = await qualificationService.update(req.params.id, req.body, req.user!.userId);
  res.json({ success: true, data: qualification });
}));

router.delete('/:id', authorize('qualifications', 'delete'), asyncHandler(async (req, res) => {
  await objectAccessService.qualificationOrNotFound(req.params.id, req.user!, 'delete');
  await qualificationService.delete(req.params.id, req.user!.userId);
  res.json({ success: true, message: '资质记录已删除' });
}));

export default router;
