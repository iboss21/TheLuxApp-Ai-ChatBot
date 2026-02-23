import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { memoryService } from '../services/memoryService';
import { NotFoundError } from '../utils/errors';

export const memoryRouter = Router();
memoryRouter.use(authMiddleware);
memoryRouter.use(tenantMiddleware);

const updateMemorySchema = z.object({
  value: z.string().min(1),
});

const consentSchema = z.object({
  consent_given: z.boolean(),
});

memoryRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const memories = await memoryService.getUserMemory(req.tenant!.id, req.user!.id);
    res.json({ memories });
  } catch (err) {
    next(err);
  }
});

memoryRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateMemorySchema.parse(req.body);
    const updated = await memoryService.updateMemory(req.tenant!.id, req.user!.id, req.params.id, body.value);
    if (!updated) throw new NotFoundError('Memory entry');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

memoryRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await memoryService.deleteMemory(req.tenant!.id, req.user!.id, req.params.id);
    if (!deleted) throw new NotFoundError('Memory entry');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

memoryRouter.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await memoryService.deleteAllMemory(req.tenant!.id, req.user!.id);
    res.json({ deleted_count: count, message: 'All memories deleted' });
  } catch (err) {
    next(err);
  }
});

memoryRouter.post('/consent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = consentSchema.parse(req.body);
    await memoryService.setConsent(req.tenant!.id, req.user!.id, body.consent_given);
    res.json({ consent_given: body.consent_given, message: 'Consent updated' });
  } catch (err) {
    next(err);
  }
});
