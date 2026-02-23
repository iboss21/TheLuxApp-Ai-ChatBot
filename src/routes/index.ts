import { Router } from 'express';
import { authRouter } from './auth';
import { chatRouter } from './chat';
import { knowledgeRouter } from './knowledge';
import { toolsRouter } from './tools';
import { memoryRouter } from './memory';
import { adminRouter } from './admin';
import { platformRouter } from './platform';

export function createRouter(): Router {
  const router = Router();

  router.use('/auth', authRouter);
  router.use('/v1', chatRouter);
  router.use('/v1/knowledge', knowledgeRouter);
  router.use('/v1/tools', toolsRouter);
  router.use('/v1/memory', memoryRouter);
  router.use('/v1/admin', adminRouter);
  router.use('/v1/platform', platformRouter);

  return router;
}
