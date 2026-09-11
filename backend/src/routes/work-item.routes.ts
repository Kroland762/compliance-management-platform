import { Router, Request, Response } from 'express';
import { authorizeAny } from '../middlewares/auth';
import workItemService from '../services/work-item.service';
import { asyncHandler } from '../utils/http';

const router = Router();

router.get('/', authorizeAny(
  ['evaluations', 'read'],
  ['remediation_actions', 'read'],
  ['risks', 'confirm'],
  ['risks', 'verify'],
), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await workItemService.list(req.user!) });
}));

export default router;
