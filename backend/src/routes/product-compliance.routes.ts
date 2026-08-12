import { Router } from 'express';
import { authorize, authorizeAny } from '../middlewares/auth';
import productComplianceService from '../services/product-compliance.service';
import { asyncHandler } from '../utils/http';
import { parseExpectedLockVersion } from '../utils/optimistic-lock';

const router = Router();

router.get('/products', authorize('products', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.listProducts(req.query, req.user!) });
}));
router.post('/products', authorize('products', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await productComplianceService.createProduct(req.body, req.user!) });
}));
router.get('/products/:id', authorize('products', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.getProduct(req.params.id, req.user!) });
}));
router.put('/products/:id', authorize('products', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateProduct(req.params.id, req.body, req.user!) });
}));
router.post('/products/:id/archive', authorize('products', 'archive'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.archiveProduct(req.params.id, req.user!) });
}));
router.post('/products/:id/versions', authorize('products', 'update'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await productComplianceService.createVersion(req.params.id, req.body, req.user!) });
}));
router.put('/products/:productId/versions/:versionId', authorize('products', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateVersion(req.params.productId, req.params.versionId, req.body, req.user!) });
}));
router.delete('/products/:productId/versions/:versionId', authorize('products', 'update'), asyncHandler(async (req, res) => {
  await productComplianceService.deleteVersion(req.params.productId, req.params.versionId, req.user!);
  res.json({ success: true, message: '产品版本已删除' });
}));

router.get('/review-queue', authorize('product_dossiers', 'review'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.listReviewQueue(req.query, req.user!) });
}));
router.get('/dossiers/:id', authorize('product_dossiers', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.getDossier(req.params.id, req.user!) });
}));
router.get('/dossiers/:id/inheritance-diff', authorize('product_dossiers', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.inheritanceDiff(req.params.id, req.user!) });
}));
router.put('/dossiers/:id/overview', authorize('product_dossiers', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateOverview(req.params.id, req.body, parseExpectedLockVersion(req), req.user!) });
}));
router.put('/dossiers/:id/answers', authorize('product_dossiers', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.saveAnswers(req.params.id, req.body.answers, parseExpectedLockVersion(req), req.user!) });
}));
router.put('/dossiers/:id/inventory', authorize('product_dossiers', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.saveInventory(req.params.id, req.body, parseExpectedLockVersion(req), req.user!) });
}));
router.put('/dossiers/:id/questionnaires', authorize('product_dossiers', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.adjustQuestionnaires(req.params.id, req.body, parseExpectedLockVersion(req), req.user!) });
}));
router.post('/dossiers/:id/submit', authorize('product_dossiers', 'submit'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.submit(req.params.id, parseExpectedLockVersion(req), req.user!) });
}));
router.post('/dossiers/:id/return', authorize('product_dossiers', 'review'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.returnForChanges(req.params.id, req.body.reason, parseExpectedLockVersion(req), req.user!) });
}));
router.post('/dossiers/:id/confirm', authorize('product_dossiers', 'confirm'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.confirm(req.params.id, req.body.conclusion, parseExpectedLockVersion(req), req.user!) });
}));
router.post('/dossiers/:id/revisions', authorize('product_dossiers', 'revise'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await productComplianceService.revise(req.params.id, req.user!) });
}));

router.get('/config/product-types', authorizeAny(['product_compliance_config', 'read'], ['products', 'read']), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.listProductTypes(req.query.includeRetired === 'true') });
}));
router.post('/config/product-types', authorize('product_compliance_config', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await productComplianceService.createProductType(req.body, req.user!) });
}));
router.put('/config/product-types/:id', authorize('product_compliance_config', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateProductType(req.params.id, req.body, req.user!) });
}));
router.post('/config/product-types/:id/retire', authorize('product_compliance_config', 'retire'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateProductType(req.params.id, { status: 'retired' }, req.user!) });
}));

router.get('/config/questionnaires', authorizeAny(['product_compliance_config', 'read'], ['product_dossiers', 'update']), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.listTemplates(req.query.includeRetired === 'true') });
}));
router.post('/config/questionnaires', authorize('product_compliance_config', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await productComplianceService.createTemplate(req.body, req.user!) });
}));
router.get('/config/questionnaires/:id', authorize('product_compliance_config', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.getTemplate(req.params.id) });
}));
router.put('/config/questionnaires/:id', authorize('product_compliance_config', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateTemplate(req.params.id, req.body, req.user!) });
}));
router.post('/config/questionnaires/:id/retire', authorize('product_compliance_config', 'retire'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.updateTemplate(req.params.id, { status: 'retired' }, req.user!) });
}));

router.get('/config/rules', authorize('product_compliance_config', 'read'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await productComplianceService.listRules() });
}));
router.put('/config/product-types/:id/rules', authorize('product_compliance_config', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productComplianceService.saveRules(req.params.id, req.body.rules, req.user!) });
}));

export default router;
