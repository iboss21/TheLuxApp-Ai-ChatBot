import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { authMiddleware, requireRole } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export const platformRouter = Router();
platformRouter.use(authMiddleware);
platformRouter.use(requireRole('super_admin'));

const createTenantSchema = z.object({
  slug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
  display_name: z.string().min(1).max(255),
  region: z.string().min(1).max(31),
  tier: z.enum(['standard', 'enterprise', 'regulated']).default('standard'),
  deployment_mode: z.enum(['saas', 'vpc', 'on-prem']).default('saas'),
});

platformRouter.post('/tenants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createTenantSchema.parse(req.body);
    const result = await query(
      `INSERT INTO tenants (slug, display_name, region, tier, deployment_mode)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, slug, display_name, region, tier, deployment_mode, status, created_at`,
      [body.slug, body.display_name, body.region, body.tier, body.deployment_mode]
    );
    logger.info({ tenantId: (result.rows[0] as { id: string }).id, slug: body.slug }, 'Tenant provisioned');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/tenants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);

    const result = await query(
      'SELECT id, slug, display_name, region, tier, deployment_mode, status, created_at FROM tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json({ tenants: result.rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

platformRouter.put('/tenants/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const body = req.body as { display_name?: string; tier?: string; region?: string };
    const result = await query(
      `UPDATE tenants
       SET display_name = COALESCE($2, display_name),
           tier = COALESCE($3, tier),
           region = COALESCE($4, region),
           updated_at = now()
       WHERE id = $1
       RETURNING id, slug, display_name, region, tier, status`,
      [id, body.display_name, body.tier, body.region]
    );
    if (result.rows.length === 0) throw new NotFoundError('Tenant');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/tenants/:id/suspend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1 RETURNING id, slug, status`,
      [id]
    );
    if (result.rows.length === 0) throw new NotFoundError('Tenant');
    logger.info({ tenantId: id }, 'Tenant suspended');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const dbResult = await query<{ ok: number }>('SELECT 1 as ok');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbResult.rows[0].ok === 1 ? 'healthy' : 'unhealthy',
        api: 'healthy',
      },
    });
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/metrics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [tenantCount, convCount, msgCount] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) as count FROM tenants WHERE status = $1', ['active']),
      query<{ count: string }>('SELECT COUNT(*) as count FROM conversations'),
      query<{ count: string }>('SELECT COUNT(*) as count FROM messages'),
    ]);

    res.json({
      tenants: { active: parseInt(tenantCount.rows[0].count, 10) },
      conversations: { total: parseInt(convCount.rows[0].count, 10) },
      messages: { total: parseInt(msgCount.rows[0].count, 10) },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
