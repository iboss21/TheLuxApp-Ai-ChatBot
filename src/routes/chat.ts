import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { orchestratorService } from '../services/orchestrator';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export const chatRouter = Router();
chatRouter.use(authMiddleware);
chatRouter.use(tenantMiddleware);

const chatCompletionSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1),
  })).min(1),
  stream: z.boolean().default(false),
  tools_enabled: z.boolean().default(true),
  knowledge_enabled: z.boolean().default(true),
  model: z.string().optional(),
  provider: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const createConversationSchema = z.object({
  channel: z.enum(['web', 'slack', 'teams', 'api', 'mobile']).default('web'),
  metadata: z.record(z.unknown()).default({}),
});

chatRouter.post('/chat/completions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = chatCompletionSchema.parse(req.body);
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;

    let conversationId = body.conversation_id;
    if (!conversationId) {
      const convResult = await query<{ id: string }>(
        `INSERT INTO conversations (tenant_id, user_id, channel) VALUES ($1, $2, 'api') RETURNING id`,
        [tenantId, userId]
      );
      conversationId = convResult.rows[0].id;
    }

    const userMessage = body.messages[body.messages.length - 1];
    await query(
      `INSERT INTO messages (conversation_id, tenant_id, role, content) VALUES ($1, $2, $3, $4)`,
      [conversationId, tenantId, userMessage.role, userMessage.content]
    );

    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      await orchestratorService.streamProcess({
        tenantId,
        userId,
        conversationId,
        messages: body.messages,
        stream: true,
        toolsEnabled: body.tools_enabled,
        knowledgeEnabled: body.knowledge_enabled,
        modelOptions: {
          model: body.model,
          provider: body.provider,
          maxTokens: body.max_tokens,
          temperature: body.temperature,
        },
      }, res);

      res.end();
      return;
    }

    const result = await orchestratorService.process({
      tenantId,
      userId,
      conversationId,
      messages: body.messages,
      toolsEnabled: body.tools_enabled,
      knowledgeEnabled: body.knowledge_enabled,
      modelOptions: {
        model: body.model,
        provider: body.provider,
        maxTokens: body.max_tokens,
        temperature: body.temperature,
      },
    });

    res.json({
      id: uuidv4(),
      conversation_id: conversationId,
      content: result.content,
      citations: result.citations,
      tool_calls: result.toolCalls,
      model: result.model,
      usage: result.usage,
      safety_flags: result.safetyFlags,
    });
  } catch (err) {
    next(err);
  }
});

chatRouter.post('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createConversationSchema.parse(req.body);
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;

    const result = await query<{ id: string; channel: string; status: string; created_at: string }>(
      `INSERT INTO conversations (tenant_id, user_id, channel, metadata) VALUES ($1, $2, $3, $4) RETURNING id, channel, status, created_at`,
      [tenantId, userId, body.channel, JSON.stringify(body.metadata)]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

chatRouter.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;
    const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10), 100);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);

    const result = await query<{
      id: string; channel: string; status: string; created_at: string; updated_at: string; message_count: string;
    }>(
      `SELECT c.id, c.channel, c.status, c.created_at, c.updated_at,
              COUNT(m.id) as message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.tenant_id = $1 AND c.user_id = $2 AND c.status != 'deleted'
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, userId, limit, offset]
    );

    res.json({ conversations: result.rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

chatRouter.get('/conversations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;
    const { id } = req.params;

    const convResult = await query<{ id: string; channel: string; status: string; created_at: string }>(
      'SELECT id, channel, status, created_at FROM conversations WHERE id = $1 AND tenant_id = $2 AND user_id = $3',
      [id, tenantId, userId]
    );

    if (convResult.rows.length === 0) throw new NotFoundError('Conversation');

    const msgResult = await query<{
      id: string; role: string; content: string; citations: unknown; tool_calls: unknown; model_used: string; created_at: string;
    }>(
      'SELECT id, role, content, citations, tool_calls, model_used, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({ ...convResult.rows[0], messages: msgResult.rows });
  } catch (err) {
    next(err);
  }
});

chatRouter.delete('/conversations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;
    const { id } = req.params;

    const result = await query(
      `UPDATE conversations SET status = 'archived' WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, tenantId, userId]
    );

    if ((result.rowCount ?? 0) === 0) throw new NotFoundError('Conversation');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

chatRouter.post('/conversations/:id/escalate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant!.id;
    const userId = req.user!.id;
    const { id } = req.params;

    const result = await query(
      `UPDATE conversations SET status = 'escalated', metadata = metadata || jsonb_build_object('escalated_at', now()::text, 'escalation_reason', 'user_request')
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, tenantId, userId]
    );

    if ((result.rowCount ?? 0) === 0) throw new NotFoundError('Conversation');

    await query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_type, action, resource_type, resource_id, detail)
       VALUES ($1, $2, 'user', 'conversation.escalated', 'conversation', $3, $4)`,
      [tenantId, userId, id, JSON.stringify({ reason: (req.body as { reason?: string }).reason ?? 'user_request' })]
    );

    res.json({ id, status: 'escalated', message: 'Conversation escalated to human agent' });
  } catch (err) {
    next(err);
  }
});
