import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import assetService from '../services/asset.service';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

router.get('/', authorize('assets', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.list(req.query, req.user!) });
}));

router.post('/', authorize('assets', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await assetService.create(req.body, req.user!) });
}));

router.put('/:id', authorize('assets', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.update(req.params.id, req.body, req.user!) });
}));

router.post('/:id/archive', authorize('assets', 'archive'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.archive(req.params.id, req.user!) });
}));

export default router;
