import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import ruleEngineService from '../../services/account/ruleEngine.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/account/rules
 * 列表查询 - ADMIN & AUDITOR
 */
router.get('/', authorize('rules', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await ruleEngineService.listRules(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/rules/:id
 * 详情 - ADMIN & AUDITOR
 */
router.get('/:id', authorize('rules', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await ruleEngineService.getRule(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计规则不存在' ? 404 : 500;
    res.status(status).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/rules
 * 创建自定义规则 - ADMIN only
 */
router.post('/', authorize('rules', 'create'), async (req: Request, res: Response) => {
  try {
    const result = await ruleEngineService.createRule(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/account/rules/:id
 * 更新规则 - ADMIN only
 */
router.put('/:id', authorize('rules', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await ruleEngineService.updateRule(req.params.id, req.body);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计规则不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * PATCH /api/account/rules/:id/toggle
 * 启用/禁用 - ADMIN only
 */
router.patch('/:id/toggle', authorize('rules', 'toggle'), async (req: Request, res: Response) => {
  try {
    const result = await ruleEngineService.toggleRule(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计规则不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'TOGGLE_FAILED', message: error.message } });
  }
});

/**
 * PATCH /api/account/rules/:id/params
 * 修改内置规则的参数配置（如 { days: 180 }）- ADMIN only
 */
router.patch('/:id/params', authorize('rules', 'update'), async (req: Request, res: Response) => {
  try {
    const { paramsConfig } = req.body;
    if (paramsConfig === undefined) {
      res.status(400).json({ success: false, error: { code: 'MISSING_PARAMS', message: 'paramsConfig 字段不能为空' } });
      return;
    }
    const result = await ruleEngineService.updateRuleParams(req.params.id, paramsConfig);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计规则不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_PARAMS_FAILED', message: error.message } });
  }
});

/**
 * DELETE /api/account/rules/:id
 * 删除（仅自定义规则）- ADMIN only
 */
router.delete('/:id', authorize('rules', 'delete'), async (req: Request, res: Response) => {
  try {
    await ruleEngineService.deleteRule(req.params.id);
    res.json({ success: true, message: '规则已删除' });
  } catch (error: any) {
    const status = error.message === '审计规则不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
