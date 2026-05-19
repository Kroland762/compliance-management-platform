import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import sequelize from '../config/database';
import { QueryTypes } from 'sequelize';

const router = Router();
router.use(authenticate);

/**
 * GET /api/lookup/departments?q=xxx — 检索部门
 */
router.get('/departments', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const rows = await sequelize.query(
      `SELECT DISTINCT department FROM users WHERE is_active=true AND department IS NOT NULL AND department ILIKE $1 ORDER BY department LIMIT 20`,
      { bind: [`%${q}%`], type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/lookup/personnel?q=xxx&department=xxx — 检索人员
 */
router.get('/personnel', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const dept = req.query.department as string;
    // 搜索所有活跃用户（不限角色）
    let sql = `SELECT id, username, department, role FROM users WHERE is_active=true AND username ILIKE $1`;
    const bind: any[] = [`%${q}%`];
    if (dept) {
      sql += ` AND department ILIKE $2`;
      bind.push(`%${dept}%`);
    }
    sql += ` ORDER BY username LIMIT 20`;
    const rows = await sequelize.query(sql, { bind, type: QueryTypes.SELECT });
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

export default router;
