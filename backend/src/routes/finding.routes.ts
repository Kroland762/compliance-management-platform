import { Router, Request, Response } from 'express';
import { authorize } from '../middlewares/auth';
import findingService from '../services/finding.service';
import riskDomainService from '../services/risk-domain.service';
import { asyncHandler } from '../utils/http';
import { parseExpectedLockVersion } from '../utils/optimistic-lock';

const router = Router();

router.get('/', authorize('findings', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await findingService.list(req.query, req.user!) });
}));

router.post('/escalate', authorize('findings', 'escalate'), asyncHandler(async (req: Request, res: Response) => {
  const risk = await riskDomainService.createFromFindings(req.body, req.user!, req.header('Idempotency-Key'));
  res.status(201).json({ success: true, data: risk });
}));

router.get('/:id', authorize('findings', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await findingService.detail(req.params.id, req.user!) });
}));

router.post('/:id/remediate', authorize('findings', 'remediate'), asyncHandler(async (req: Request, res: Response) => {
  const finding = await findingService.remediate(
    req.params.id,
    req.body,
    req.user!,
    parseExpectedLockVersion(req),
    req.header('Idempotency-Key'),
  );
  res.status(201).json({ success: true, data: finding });
}));

router.post('/:findingId/actions/:actionId/verify', authorize('findings', 'verify'), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await findingService.verifyAction(
      req.params.findingId,
      req.params.actionId,
      req.body,
      req.user!,
      parseExpectedLockVersion(req),
    ),
  });
}));

export default router;
