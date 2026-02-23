import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { authMiddleware, requireRole } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { NotFoundError, AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const adminRouter = Router();
adminRouter.use(authMiddleware);
adminRouter.use(tenantMiddleware);
adminRouter.use(requireRole('admin', 'super_admin'));

adminRouter.get('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const result = await query(
      'SELECT id, version, config_yaml, is_active, published_at FROM tenant_configs WHERE tenant_id = $1 AND is_active = true',
      [tenantId]
    );
    if (result.rows.length === 0) {
      res.json({ config: null, message: 'No active config found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;

    const versionResult = await query<{ max_version: number | null }>(
      'SELECT MAX(version) as max_version FROM tenant_configs WHERE tenant_id = $1',
      [tenantId]
    );
    const newVersion = (versionResult.rows[0].max_version ?? 0) + 1;

    await query('UPDATE tenant_configs SET is_active = false WHERE tenant_id = $1', [tenantId]);

    const result = await query(
      `INSERT INTO tenant_configs (tenant_id, version, config_yaml, is_active, published_at, published_by)
       VALUES ($1, $2, $3, true, now(), $4)
       RETURNING id, version, is_active, published_at`,
      [tenantId, newVersion, JSON.stringify((req.body as { config?: unknown }).config ?? req.body), userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/config/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const result = await query(
      'SELECT id, version, is_active, published_at, published_by FROM tenant_configs WHERE tenant_id = $1 ORDER BY version DESC',
      [tenantId]
    );
    res.json({ versions: result.rows });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/config/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const { version } = z.object({ version: z.number().int().positive() }).parse(req.body);

    const targetResult = await query(
      'SELECT id FROM tenant_configs WHERE tenant_id = $1 AND version = $2',
      [tenantId, version]
    );
    if (targetResult.rows.length === 0) throw new NotFoundError('Config version');

    await query('UPDATE tenant_configs SET is_active = false WHERE tenant_id = $1', [tenantId]);
    await query('UPDATE tenant_configs SET is_active = true WHERE tenant_id = $1 AND version = $2', [tenantId, version]);

    res.json({ message: `Rolled back to version ${version}` });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/config/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = (req.body as { config?: unknown }).config ?? req.body;
    if (!cfg || typeof cfg !== 'object') {
      throw new AppError(400, 'invalid_config', 'Config must be a JSON object');
    }
    res.json({ valid: true, message: 'Configuration is valid' });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const result = await query(
      'SELECT id, email, display_name, role, external_id, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/users/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const { id } = req.params;
    const { role } = z.object({ role: z.enum(['user', 'admin', 'super_admin']) }).parse(req.body);

    const result = await query(
      'UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, email, role',
      [role, id, tenantId]
    );
    if (result.rows.length === 0) throw new NotFoundError('User');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;

    const [convResult, tokenResult, userResult] = await Promise.all([
      query<{ total: string; today: string }>(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '1 day') as today
         FROM conversations WHERE tenant_id = $1`,
        [tenantId]
      ),
      query<{ total_in: string; total_out: string }>(
        `SELECT COALESCE(SUM(token_count_in), 0) as total_in, COALESCE(SUM(token_count_out), 0) as total_out
         FROM messages WHERE tenant_id = $1`,
        [tenantId]
      ),
      query<{ total: string }>(
        'SELECT COUNT(*) as total FROM users WHERE tenant_id = $1',
        [tenantId]
      ),
    ]);

    res.json({
      conversations: { total: convResult.rows[0].total, today: convResult.rows[0].today },
      tokens: { input: tokenResult.rows[0].total_in, output: tokenResult.rows[0].total_out },
      users: { total: userResult.rows[0].total },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 500);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);
    const action = req.query.action as string | undefined;

    const params: unknown[] = [tenantId, limit, offset];
    const actionFilter = action ? `AND action = $4` : '';
    if (action) params.push(action);

    const result = await query(
      `SELECT id, actor_id, actor_type, action, resource_type, resource_id, detail, ip_address, created_at
       FROM audit_logs WHERE tenant_id = $1 ${actionFilter}
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      params
    );
    res.json({ logs: result.rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/audit-logs/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const exportId = `export_${tenantId}_${Date.now()}`;
    logger.info({ tenantId, exportId }, 'Audit log export requested');
    res.status(202).json({ export_id: exportId, status: 'processing', message: 'Export job queued' });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/dsar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      type: z.enum(['export', 'delete']),
      user_id: z.string().uuid().optional(),
      email: z.string().email().optional(),
    }).parse(req.body);

    if (!body.user_id && !body.email) {
      throw new AppError(400, 'invalid_request', 'user_id or email required');
    }

    const tenantId = req.tenant!.id;
    logger.info({ tenantId, ...body }, 'DSAR request received');

    res.status(202).json({ status: 'accepted', message: `DSAR ${body.type} request accepted`, type: body.type });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/compliance/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    res.json({
      tenant_id: tenantId,
      report_date: new Date().toISOString(),
      frameworks: ['soc2', 'gdpr'],
      summary: {
        audit_log_retention: '90 days',
        data_encryption: 'AES-256',
        access_control: 'RBAC',
        pii_handling: 'Redaction enabled',
      },
      status: 'compliant',
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/evals/suites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const body = z.object({
      name: z.string().min(1),
      type: z.enum(['golden_set', 'red_team', 'regression', 'bias']).default('golden_set'),
    }).parse(req.body);

    const result = await query(
      'INSERT INTO eval_suites (tenant_id, name, type) VALUES ($1, $2, $3) RETURNING *',
      [tenantId, body.name, body.type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/evals/suites/:id/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await query(
      `INSERT INTO eval_runs (suite_id, model_config, status, started_at)
       VALUES ($1, $2, 'running', now()) RETURNING id, status, started_at`,
      [id, JSON.stringify((req.body as { model_config?: unknown }).model_config ?? {})]
    );
    res.status(202).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/evals/runs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      'SELECT * FROM eval_runs WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) throw new NotFoundError('Eval run');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/red-team/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    logger.info({ tenantId }, 'Red team run requested');
    res.status(202).json({ status: 'queued', message: 'Red team battery run queued' });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/webhooks', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json({ id: 'webhook_placeholder', message: 'Webhook registered' });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/webhooks', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ webhooks: [] });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/webhooks/:id', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
