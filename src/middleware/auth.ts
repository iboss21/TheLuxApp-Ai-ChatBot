import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { query } from '../db';
import { AuthError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface JwtPayload {
  sub: string;
  tid: string;
  role: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; tenantId: string; role: string };
      tenant?: { id: string; slug: string };
      apiKeyId?: string;
      /** Raw request body buffer — populated for webhook signature verification */
      rawBody?: Buffer;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) throw new AuthError('Missing Authorization header');

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
      } catch {
        throw new AuthError('Invalid or expired token');
      }
      req.user = { id: payload.sub, tenantId: payload.tid, role: payload.role };
      next();
      return;
    }

    if (authHeader.startsWith('ApiKey ')) {
      const rawKey = authHeader.slice(7);
      const tenantId = req.headers['x-tenant-id'] as string;
      if (!tenantId) throw new AuthError('X-Tenant-ID header required for API key auth');

      const result = await query<{ id: string; key_hash: string; scopes: string[]; tenant_id: string }>(
        'SELECT id, key_hash, scopes, tenant_id FROM api_keys WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at > now())',
        [tenantId]
      );

      let matched: { id: string; scopes: string[]; tenant_id: string } | null = null;
      for (const row of result.rows) {
        const ok = await bcrypt.compare(rawKey, row.key_hash);
        if (ok) { matched = row; break; }
      }
      if (!matched) throw new AuthError('Invalid API key');

      req.user = { id: 'api-key-user', tenantId: matched.tenant_id, role: 'api_key' };
      req.apiKeyId = matched.id;
      next();
      return;
    }

    throw new AuthError('Unsupported authorization scheme');
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) { next(new AuthError()); return; }
    if (!roles.includes(req.user.role)) {
      next(new AuthError('Insufficient permissions', 'forbidden'));
      return;
    }
    next();
  };
}
