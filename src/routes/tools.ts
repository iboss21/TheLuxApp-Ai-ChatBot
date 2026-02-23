import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { toolService } from '../services/toolService';
import { NotFoundError } from '../utils/errors';

export const toolsRouter = Router();
toolsRouter.use(authMiddleware);
toolsRouter.use(tenantMiddleware);

const createToolSchema = z.object({
  name: z.string().min(1).max(255),
  display_name: z.string().optional(),
  description: z.string().default(''),
  input_schema: z.record(z.unknown()),
  output_schema: z.record(z.unknown()).optional(),
  endpoint_config: z.record(z.unknown()),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  requires_confirm: z.boolean().default(false),
  rate_limit: z.number().int().positive().default(10),
});

toolsRouter.post('/', requireRole('admin', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createToolSchema.parse(req.body);
    const tenantId = req.tenant!.id;
    const tool = await toolService.createTool(tenantId, body);
    res.status(201).json(tool);
  } catch (err) {
    next(err);
  }
});

toolsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const tools = await toolService.listTools(tenantId);
    res.json({ tools });
  } catch (err) {
    next(err);
  }
});

toolsRouter.put('/:id', requireRole('admin', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const tool = await toolService.updateTool(tenantId, req.params.id, req.body as Record<string, unknown>);
    if (!tool) throw new NotFoundError('Tool');
    res.json(tool);
  } catch (err) {
    next(err);
  }
});

toolsRouter.delete('/:id', requireRole('admin', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const deleted = await toolService.deleteTool(tenantId, req.params.id);
    if (!deleted) throw new NotFoundError('Tool');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

toolsRouter.post('/:id/test', requireRole('admin', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const tool = await toolService.getTool(tenantId, req.params.id);
    if (!tool) throw new NotFoundError('Tool');

    const testConversationId = '00000000-0000-0000-0000-000000000000';
    const execution = await toolService.executeTool(tenantId, testConversationId, tool.id, req.user!.id, (req.body as { args?: Record<string, unknown> }).args ?? {});
    res.json({ execution });
  } catch (err) {
    next(err);
  }
});

toolsRouter.post('/executions/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const execution = await toolService.confirmExecution(tenantId, req.params.id, req.user!.id);
    res.json({ execution });
  } catch (err) {
    next(err);
  }
});
