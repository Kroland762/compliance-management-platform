import { Router, Request, Response } from 'express';
import { authenticate, authorize, authorizeAny } from '../middlewares/auth';
import riskDomainService from '../services/risk-domain.service';
import { asyncHandler } from '../utils/http';
import remediationService from '../services/remediation.service';

const router = Router();
router.use(authenticate);

router.get('/', authorize('risks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await riskDomainService.list(req.query, req.user!) });
}));

router.get('/:id', authorize('risks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await riskDomainService.detail(req.params.id, req.user!) });
}));

router.post('/', authorize('risks', 'create'), asyncHandler(async (req: Request, res: Response) => {
  const risk = await riskDomainService.create(req.body, req.user!);
  res.status(201).json({ success: true, data: risk });
}));

router.put('/:id/sources', authorize('risks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await riskDomainService.replaceSources(req.params.id, req.body.sources, req.user!) });
}));

router.put('/:id/assets', authorize('risks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await riskDomainService.replaceAssets(req.params.id, req.body.assets, req.user!) });
}));

router.post('/:id/confirm', authorize('risks', 'confirm'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await riskDomainService.confirm(req.params.id, req.user!) });
}));

router.post('/:id/accept', authorize('risks', 'accept'), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await riskDomainService.accept(req.params.id, req.body.reason, req.body.reviewDueDate, req.user!),
  });
}));

router.post('/:id/close', authorize('risks', 'close'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await riskDomainService.close(req.params.id, req.body.comment, req.user!) });
}));

router.post('/:riskId/actions/:actionId/verify', authorizeAny(
  ['risks', 'verify'],
  ['remediation_actions', 'verify'],
), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await remediationService.verify(req.params.riskId, req.params.actionId, req.body, req.user!),
  });
}));

router.delete('/:id', authorize('risks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  await riskDomainService.remove(req.params.id, req.user!);
  res.status(204).send();
}));

export default router;
