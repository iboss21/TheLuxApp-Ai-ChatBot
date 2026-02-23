import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { cacheGet, cacheSet } from '../cache';
import { AuthError, NotFoundError } from '../utils/errors';

export async function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId =
      (req.headers['x-tenant-id'] as string) ??
      req.user?.tenantId;

    if (!tenantId) {
      next(new AuthError('X-Tenant-ID header is required', 'tenant_missing'));
      return;
    }

    const cacheKey = `tenant:${tenantId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      req.tenant = JSON.parse(cached) as { id: string; slug: string };
      next();
      return;
    }

    const result = await query<{ id: string; slug: string; status: string }>(
      'SELECT id, slug, status FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      next(new NotFoundError('Tenant'));
      return;
    }

    const tenant = result.rows[0];
    if (tenant.status !== 'active') {
      next(new AuthError('Tenant is suspended', 'tenant_suspended'));
      return;
    }

    req.tenant = { id: tenant.id, slug: tenant.slug };
    await cacheSet(cacheKey, JSON.stringify(req.tenant), 300);
    next();
  } catch (err) {
    next(err);
  }
}
