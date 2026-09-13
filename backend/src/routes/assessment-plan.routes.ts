import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import assessmentPlanService from '../services/assessment-plan.service';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

router.get('/', authorize('assessment_plans', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await assessmentPlanService.list(req.query, req.user!) });
}));

router.get('/:id', authorize('assessment_plans', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await assessmentPlanService.detail(req.params.id, req.user!) });
}));

router.post('/', authorize('assessment_plans', 'create'), asyncHandler(async (req: Request, res: Response) => {
  const plan = await assessmentPlanService.create(req.body, req.user!);
  res.status(201).json({ success: true, data: plan });
}));

router.put('/:id', authorize('assessment_plans', 'update'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await assessmentPlanService.update(req.params.id, req.body, req.user!) });
}));

router.post('/:id/trigger', authorize('assessment_plans', 'execute'), asyncHandler(async (req: Request, res: Response) => {
  res.status(202).json({ success: true, data: await assessmentPlanService.trigger(req.params.id, req.user!) });
}));

export default router;
