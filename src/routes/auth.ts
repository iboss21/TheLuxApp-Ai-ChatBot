import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { config } from '../config';
import { authMiddleware, requireRole } from '../middleware/auth';
import { AppError, AuthError } from '../utils/errors';
import { logger } from '../utils/logger';

export const authRouter = Router();

const tokenSchema = z.object({
  grant_type: z.enum(['password', 'client_credentials']),
  username: z.string().optional(),
  password: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  tenant_id: z.string().uuid(),
});

const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).default([]),
  expires_at: z.string().datetime().optional(),
});

authRouter.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = tokenSchema.parse(req.body);

    if (body.grant_type === 'password') {
      if (!body.username || !body.password) {
        throw new AppError(400, 'invalid_request', 'username and password required');
      }

      const userResult = await query<{ id: string; tenant_id: string; role: string; email: string }>(
        'SELECT id, tenant_id, role, email FROM users WHERE tenant_id = $1 AND email = $2',
        [body.tenant_id, body.username]
      );

      if (userResult.rows.length === 0) {
        throw new AuthError('Invalid credentials');
      }

      const user = userResult.rows[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token = jwt.sign(
        { sub: user.id, tid: user.tenant_id, role: user.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] }
      );

      res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 28800,
      });
      return;
    }

    throw new AppError(400, 'unsupported_grant_type', 'Unsupported grant type');
  } catch (err) {
    next(err);
  }
});

authRouter.post('/api-keys', authMiddleware, requireRole('admin', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createApiKeySchema.parse(req.body);
    const tenantId = req.user!.tenantId;

    const rawKey = `lux_${uuidv4().replace(/-/g, '')}`;
    const keyHash = await bcrypt.hash(rawKey, 12);

    const result = await query<{ id: string; name: string; scopes: string[]; created_at: string }>(
      `INSERT INTO api_keys (tenant_id, key_hash, name, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, scopes, created_at`,
      [tenantId, keyHash, body.name, body.scopes, body.expires_at ?? null]
    );

    const key = result.rows[0];
    logger.info({ tenantId, keyId: key.id }, 'API key created');

    res.status(201).json({
      id: key.id,
      name: key.name,
      scopes: key.scopes,
      key: rawKey,
      created_at: key.created_at,
      note: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/api-keys/:id', authMiddleware, requireRole('admin', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    const result = await query(
      'DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new AppError(404, 'not_found', 'API key not found');
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
