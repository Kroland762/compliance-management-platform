import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import assessmentScopeService from '../services/assessment-scope.service';
import { asyncHandler } from '../utils/http';
import evaluationService from '../services/evaluation.service';

const router = Router();
router.use(authenticate);

router.get('/:id/assets', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  const items = await assessmentScopeService.getAssets(req.params.id, req.user!);
  res.json({ success: true, data: { items } });
}));

router.put('/:id/assets', authorize('tasks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  const items = await assessmentScopeService.replaceAssets(req.params.id, req.body.assetIds, req.user!);
  res.json({ success: true, data: { items } });
}));

router.get('/:id/control-asset-matrix', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  const items = await assessmentScopeService.getMatrix(req.params.id, req.user!);
  res.json({ success: true, data: { items } });
}));

router.put('/:id/control-asset-matrix', authorize('tasks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  const items = await assessmentScopeService.replaceMatrix(req.params.id, req.body.items, req.user!);
  res.json({ success: true, data: { items } });
}));

router.post('/:id/publish', authorize('tasks', 'publish'), asyncHandler(async (req: Request, res: Response) => {
  const result = await assessmentScopeService.publish(req.params.id, req.user!);
  res.json({ success: true, data: result });
}));

router.get('/:id/evaluations/filter-options', authorize('evaluations', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await evaluationService.filterOptions(req.params.id, req.user!) });
}));

router.get('/:id/evaluations', authorize('evaluations', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await evaluationService.list(req.params.id, req.query, req.user!) });
}));

export default router;
