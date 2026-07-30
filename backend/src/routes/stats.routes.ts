import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import reportingService from '../services/reporting.service';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate, authorize('dashboard', 'read'));

router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await reportingService.dashboard(req.user!) });
}));

export default router;
