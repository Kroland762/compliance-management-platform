import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import userService from '../services/user.service';

const router = Router();

router.use(authenticate);

// 创建用户
router.post('/', authorize('users', 'create'), async (req: Request, res: Response) => {
  try {
    const { username, password, department, roleId } = req.body;
    if (!username || !password || !roleId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '用户名、密码和角色为必填项' } });
      return;
    }
    const user = await userService.createUser({ username, password, department, roleId });
    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

// 用户列表
router.get('/', authorize('users', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await userService.getUsers(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

// 更新用户
router.put('/:id', authorize('users', 'update'), async (req: Request, res: Response) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body);
    res.json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

// 禁用用户
router.delete('/:id', authorize('users', 'delete'), async (req: Request, res: Response) => {
  try {
    await userService.disableUser(req.params.id);
    res.json({ success: true, message: '用户已禁用' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
