import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { knowledgeService } from '../services/knowledgeService';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export const knowledgeRouter = Router();
knowledgeRouter.use(authMiddleware);
knowledgeRouter.use(tenantMiddleware);

const createSourceSchema = z.object({
  name: z.string().min(1).max(255),
  source_type: z.enum(['confluence', 'sharepoint', 'gdrive', 'notion', 'github', 'zendesk', 's3', 'web_crawl', 'database', 'upload']),
  connection_config: z.record(z.unknown()),
  acl_mode: z.enum(['public', 'rbac', 'abac']).default('rbac'),
  sync_schedule: z.string().default('0 */4 * * *'),
});

const searchSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).default(5),
  filters: z.record(z.unknown()).optional(),
  user_groups: z.array(z.string()).default([]),
});

knowledgeRouter.post('/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSourceSchema.parse(req.body);
    const tenantId = req.tenant!.id;

    const result = await query<{ id: string; name: string; source_type: string; status: string; created_at: string }>(
      `INSERT INTO knowledge_sources (tenant_id, name, source_type, connection_config, acl_mode, sync_schedule)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, source_type, status, created_at`,
      [tenantId, body.name, body.source_type, JSON.stringify(body.connection_config), body.acl_mode, body.sync_schedule]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const result = await query(
      'SELECT id, name, source_type, acl_mode, sync_schedule, status, last_synced_at, created_at FROM knowledge_sources WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    res.json({ sources: result.rows });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.put('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const { id } = req.params;
    const body = req.body as {
      name?: string;
      connection_config?: Record<string, unknown>;
      sync_schedule?: string;
      acl_mode?: string;
    };

    const result = await query(
      `UPDATE knowledge_sources
       SET name = COALESCE($3, name),
           connection_config = COALESCE($4, connection_config),
           sync_schedule = COALESCE($5, sync_schedule),
           acl_mode = COALESCE($6, acl_mode)
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, name, source_type, status, sync_schedule, acl_mode`,
      [id, tenantId, body.name, body.connection_config ? JSON.stringify(body.connection_config) : null,
       body.sync_schedule, body.acl_mode]
    );

    if (result.rows.length === 0) throw new NotFoundError('Knowledge source');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.delete('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const { id } = req.params;

    const result = await query(
      `UPDATE knowledge_sources SET status = 'deleted' WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if ((result.rowCount ?? 0) === 0) throw new NotFoundError('Knowledge source');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/sources/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const { id } = req.params;

    const srcResult = await query(
      'SELECT id FROM knowledge_sources WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (srcResult.rows.length === 0) throw new NotFoundError('Knowledge source');

    await query(
      `UPDATE knowledge_sources SET status = 'syncing' WHERE id = $1`,
      [id]
    );

    logger.info({ tenantId, sourceId: id }, 'Knowledge source sync triggered');
    res.json({ source_id: id, status: 'syncing', message: 'Sync job enqueued' });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/sources/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const { id } = req.params;

    const result = await query<{ id: string; name: string; status: string; last_synced_at: string | null; chunk_count: string }>(
      `SELECT ks.id, ks.name, ks.status, ks.last_synced_at, COUNT(dc.id) as chunk_count
       FROM knowledge_sources ks
       LEFT JOIN documents d ON d.source_id = ks.id
       LEFT JOIN document_chunks dc ON dc.document_id = d.id
       WHERE ks.id = $1 AND ks.tenant_id = $2
       GROUP BY ks.id`,
      [id, tenantId]
    );

    if (result.rows.length === 0) throw new NotFoundError('Knowledge source');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = searchSchema.parse(req.body);
    const tenantId = req.tenant!.id;

    const results = await knowledgeService.search(tenantId, body.query, body.top_k, body.user_groups);
    res.json({ results, query: body.query, count: results.length });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;

    const result = await query<{ id: string }>(
      `SELECT id FROM knowledge_sources WHERE tenant_id = $1 AND source_type = 'upload' LIMIT 1`,
      [tenantId]
    );

    let sourceId: string;
    if (result.rows.length === 0) {
      const newSource = await query<{ id: string }>(
        `INSERT INTO knowledge_sources (tenant_id, name, source_type, connection_config)
         VALUES ($1, 'Direct Uploads', 'upload', '{}') RETURNING id`,
        [tenantId]
      );
      sourceId = newSource.rows[0].id;
    } else {
      sourceId = result.rows[0].id;
    }

    res.status(202).json({ message: 'Upload accepted', source_id: sourceId });
  } catch (err) {
    next(err);
  }
});
