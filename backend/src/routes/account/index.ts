import { Router } from 'express';
import dataSourceRoutes from './dataSource.routes';
import ruleRoutes from './rule.routes';
import taskRoutes from './task.routes';
import problemRoutes from './problem.routes';
import dashboardRoutes from './dashboard.routes';

const router = Router();

router.use('/data-sources', dataSourceRoutes);
router.use('/rules', ruleRoutes);
router.use('/tasks', taskRoutes);
router.use('/problems', problemRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
