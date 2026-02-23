/**
 * Platform Integrations Router
 *
 * Provides two sets of routes:
 *   1. Webhook endpoints (unauthenticated, platform-verified)
 *      POST /v1/integrations/discord/webhook
 *      POST /v1/integrations/slack/events
 *      POST /v1/integrations/telegram/:token/webhook
 *      POST /v1/integrations/teams/webhook
 *      GET  /v1/integrations/whatsapp/webhook  (challenge verification)
 *      POST /v1/integrations/whatsapp/webhook
 *
 *   2. Management endpoints (require admin JWT)
 *      GET    /v1/integrations/manage
 *      POST   /v1/integrations/manage
 *      PATCH  /v1/integrations/manage/:id
 *      DELETE /v1/integrations/manage/:id
 */

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { integrationService } from '../services/integrationService';
import { authMiddleware, requireRole } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { AppError, NotFoundError } from '../utils/errors';
import { config } from '../config';
import { logger } from '../utils/logger';

export const integrationsRouter = Router();

// ─── Helper ───────────────────────────────────────────────────────────────────

function getRawBody(req: Request): string {
  return (req.rawBody ?? Buffer.alloc(0)).toString('utf-8');
}

// ═════════════════════════════════════════════════════════════════════════════
// DISCORD — Slash Commands & Interactions
// Docs: https://discord.com/developers/docs/interactions/receiving-and-responding
// ═════════════════════════════════════════════════════════════════════════════

integrationsRouter.post(
  '/discord/webhook',
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-signature-ed25519'] as string | undefined;
    const timestamp  = req.headers['x-signature-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing Discord signature headers' });
      return;
    }

    const rawBody = getRawBody(req);
    const publicKey = config.discord.publicKey;

    if (!publicKey) {
      logger.error('DISCORD_PUBLIC_KEY is not configured');
      res.status(500).json({ error: 'Discord integration not configured' });
      return;
    }

    if (!integrationService.verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
      res.status(401).json({ error: 'Invalid request signature' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const interaction = req.body as any;

    // PING — Discord health check sent during webhook registration
    if (interaction.type === 1) {
      res.json({ type: 1 });
      return;
    }

    // APPLICATION_COMMAND — Slash command (e.g. /ask <message>)
    if (interaction.type === 2) {
      // Respond with ACK + deferred reply ("Bot is thinking…") immediately
      res.json({ type: 5 });

      // Process asynchronously so we don't time out the 3-second window
      setImmediate(async () => {
        const tenantId = config.discord.tenantId;
        if (!tenantId) { logger.error('DISCORD_TENANT_ID not set'); return; }

        const integration = await integrationService.findIntegration('discord', tenantId);
        if (!integration) { logger.warn('Discord integration not found in DB for tenant', { tenantId }); return; }

        const user = interaction.member?.user ?? interaction.user;
        if (!user) return;

        // Extract the message from the slash-command option named "message"
        const msgOption = (interaction.data?.options ?? []).find(
          (o: { name: string; value: string }) => o.name === 'message',
        ) as { value: string } | undefined;
        const content: string = msgOption?.value ?? '';
        if (!content.trim()) return;

        const channelId: string = interaction.channel_id ?? 'global';

        try {
          const response = await integrationService.processMessage({
            integrationId: integration.id,
            tenantId,
            platform: 'discord',
            externalUserId: String(user.id),
            externalConvId: channelId,
            content,
            metadata: { displayName: user.username },
          });

          await integrationService.patchDiscordInteraction(
            config.discord.applicationId,
            String(interaction.token),
            response.content,
          );
          await integrationService.logEvent(
            integration.id, tenantId, 'discord', 'slash_command',
            { user_id: user.id, channel: channelId },
          );
        } catch (err) {
          logger.error({ err }, 'Discord slash command processing failed');
          await integrationService.patchDiscordInteraction(
            config.discord.applicationId,
            String(interaction.token),
            '⚠️ Sorry, I ran into an error. Please try again.',
          );
          await integrationService.logEvent(
            integration.id, tenantId, 'discord', 'slash_command',
            { user_id: user.id, channel: channelId },
            err instanceof Error ? err.message : String(err),
          );
        }
      });
      return;
    }

    res.status(400).json({ error: 'Unsupported interaction type' });
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// SLACK — Events API
// Docs: https://api.slack.com/events-api
// ═════════════════════════════════════════════════════════════════════════════

integrationsRouter.post(
  '/slack/events',
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-slack-signature'] as string | undefined;
    const timestamp  = req.headers['x-slack-request-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing Slack signature headers' });
      return;
    }

    const rawBody = getRawBody(req);
    const signingSecret = config.slack.signingSecret;

    if (signingSecret && !integrationService.verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
      res.status(401).json({ error: 'Invalid Slack signature' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = req.body as any;

    // url_verification — Slack sends this when you first configure your Request URL
    if (body.type === 'url_verification') {
      res.json({ challenge: body.challenge });
      return;
    }

    // Acknowledge immediately (Slack requires a 200 within 3 seconds)
    res.status(200).send();

    if (body.type !== 'event_callback') return;
    const event = body.event;
    if (!event || event.type !== 'message') return;
    if (event.bot_id || event.subtype) return; // Ignore bot messages and edits

    setImmediate(async () => {
      const tenantId = config.slack.tenantId;
      if (!tenantId) { logger.error('SLACK_TENANT_ID not set'); return; }

      const integration = await integrationService.findIntegration('slack', tenantId);
      if (!integration) { logger.warn('Slack integration not found', { tenantId }); return; }

      const slackCfg = integration.config as { bot_token?: string };
      const botToken = slackCfg.bot_token ?? config.slack.botToken;

      const convId: string = event.thread_ts ?? event.channel;

      try {
        const response = await integrationService.processMessage({
          integrationId: integration.id,
          tenantId,
          platform: 'slack',
          externalUserId: String(event.user),
          externalConvId: convId,
          content: String(event.text ?? ''),
        });

        await integrationService.postSlackMessage(botToken, String(event.channel), response.content);
        await integrationService.logEvent(
          integration.id, tenantId, 'slack', 'message',
          { user: event.user, channel: event.channel },
        );
      } catch (err) {
        logger.error({ err }, 'Slack event processing failed');
        await integrationService.postSlackMessage(
          botToken, String(event.channel),
          '⚠️ Sorry, I ran into an error. Please try again.',
        );
        await integrationService.logEvent(
          integration.id, tenantId, 'slack', 'message',
          { user: event.user, channel: event.channel },
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// TELEGRAM — Bot Webhook
// Docs: https://core.telegram.org/bots/api#setwebhook
// The bot token in the URL path acts as a shared secret.
// ═════════════════════════════════════════════════════════════════════════════

integrationsRouter.post(
  '/telegram/:token/webhook',
  async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;
    const cfgToken = config.telegram.botToken;

    // Constant-time comparison to prevent timing attacks
    if (!cfgToken || !safeEqual(token, cfgToken)) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // Acknowledge quickly — Telegram will retry if we don't respond fast
    res.status(200).send();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update = req.body as any;
    const msg = update?.message;
    if (!msg?.text) return;

    // Handle built-in commands
    if (msg.text === '/start') {
      await integrationService.sendTelegramMessage(
        token, msg.chat.id,
        '👋 *Welcome to TheLuxApp AI ChatBot!*\n\nSend me any message and I\'ll respond with AI-powered answers.\n\nType /help for more information.',
      );
      return;
    }
    if (msg.text === '/help') {
      await integrationService.sendTelegramMessage(
        token, msg.chat.id,
        '🤖 *TheLuxApp AI ChatBot*\n\n• Simply type any question or message\n• I have access to your knowledge base\n• I can execute tools and actions\n\n*Commands:*\n/start — Start the bot\n/help — Show this help\n/clear — Reset conversation',
      );
      return;
    }
    if (msg.text === '/clear') {
      // Resetting is handled by creating a new conversation (new externalConvId)
      await integrationService.sendTelegramMessage(
        token, msg.chat.id,
        '🗑 Conversation cleared. Start fresh with your next message!',
      );
      return;
    }

    setImmediate(async () => {
      const tenantId = config.telegram.tenantId;
      if (!tenantId) { logger.error('TELEGRAM_TENANT_ID not set'); return; }

      const integration = await integrationService.findIntegration('telegram', tenantId);
      if (!integration) { logger.warn('Telegram integration not found', { tenantId }); return; }

      const userId = String(msg.from?.id ?? 'unknown');
      const displayName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username;

      try {
        const response = await integrationService.processMessage({
          integrationId: integration.id,
          tenantId,
          platform: 'telegram',
          externalUserId: userId,
          externalConvId: String(msg.chat.id),
          content: String(msg.text),
          metadata: { displayName },
        });

        await integrationService.sendTelegramMessage(token, msg.chat.id, response.content);
        await integrationService.logEvent(
          integration.id, tenantId, 'telegram', 'message',
          { user_id: userId, chat_id: msg.chat.id },
        );
      } catch (err) {
        logger.error({ err }, 'Telegram message processing failed');
        await integrationService.sendTelegramMessage(
          token, msg.chat.id,
          '⚠️ Sorry, I ran into an error. Please try again.',
        );
      }
    });
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// MICROSOFT TEAMS — Bot Framework Webhook
// Docs: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/create-a-bot-for-teams
// ═════════════════════════════════════════════════════════════════════════════

integrationsRouter.post(
  '/teams/webhook',
  async (req: Request, res: Response): Promise<void> => {
    // Teams sends messages as Activity objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activity = req.body as any;

    // Verify the request comes from our registered Teams app
    const serviceUrl = activity?.serviceUrl as string | undefined;
    if (!serviceUrl?.includes('botframework.com') && !serviceUrl?.includes('azure.com')) {
      res.status(401).json({ error: 'Unrecognised service URL' });
      return;
    }

    if (activity.type !== 'message') {
      res.status(200).json({ type: 'message', text: '' });
      return;
    }

    const text: string = (activity.text ?? '').replace(/<at>[^<]*<\/at>/g, '').trim();
    if (!text) {
      res.status(200).json({ type: 'message', text: '' });
      return;
    }

    const tenantId = config.teams.tenantId;
    if (!tenantId) {
      logger.error('TEAMS_TENANT_ID not set');
      res.status(500).json({ error: 'Teams integration not configured' });
      return;
    }

    try {
      const integration = await integrationService.findIntegration('teams', tenantId);
      if (!integration) throw new Error('Teams integration not found in DB');

      const externalUserId: string = activity.from?.aadObjectId ?? activity.from?.id ?? 'unknown';
      const displayName: string | undefined = activity.from?.name;
      const convId: string = activity.conversation?.id ?? externalUserId;

      const response = await integrationService.processMessage({
        integrationId: integration.id,
        tenantId,
        platform: 'teams',
        externalUserId,
        externalConvId: convId,
        content: text,
        metadata: { displayName },
      });

      await integrationService.logEvent(
        integration.id, tenantId, 'teams', 'message',
        { user_id: externalUserId, conv_id: convId },
      );

      // Respond inline — Teams Bot Framework expects a reply Activity
      res.json({
        type: 'message',
        text: response.content,
        replyToId: activity.id,
      });
    } catch (err) {
      logger.error({ err }, 'Teams message processing failed');
      res.json({ type: 'message', text: '⚠️ Sorry, I ran into an error. Please try again.' });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// WHATSAPP — Meta Cloud API Webhook
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
// ═════════════════════════════════════════════════════════════════════════════

// Webhook verification (GET) — Meta sends this to confirm the endpoint
integrationsRouter.get(
  '/whatsapp/webhook',
  (req: Request, res: Response): void => {
    const mode      = req.query['hub.mode'] as string;
    const token     = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    if (integrationService.verifyWhatsAppChallenge(config.whatsapp.verifyToken, mode, token)) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Verification failed' });
    }
  },
);

// Incoming messages (POST)
integrationsRouter.post(
  '/whatsapp/webhook',
  async (req: Request, res: Response): Promise<void> => {
    // Always respond 200 immediately — Meta will retry if we don't
    res.status(200).send('EVENT_RECEIVED');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = req.body as any;
    if (body.object !== 'whatsapp_business_account') return;

    setImmediate(async () => {
      const tenantId = config.whatsapp.tenantId;
      if (!tenantId) { logger.error('WHATSAPP_TENANT_ID not set'); return; }

      const integration = await integrationService.findIntegration('whatsapp', tenantId);
      if (!integration) { logger.warn('WhatsApp integration not found', { tenantId }); return; }

      const waCfg = integration.config as {
        access_token?: string;
        phone_number_id?: string;
      };
      const accessToken   = waCfg.access_token   ?? config.whatsapp.accessToken;
      const phoneNumberId = waCfg.phone_number_id ?? config.whatsapp.phoneNumberId;

      for (const entry of (body.entry ?? [])) {
        for (const change of (entry.changes ?? [])) {
          const messages = change.value?.messages ?? [];
          for (const message of messages) {
            if (message.type !== 'text') continue;
            const from: string = message.from;
            const text: string = message.text?.body ?? '';
            if (!text.trim()) continue;

            try {
              const response = await integrationService.processMessage({
                integrationId: integration.id,
                tenantId,
                platform: 'whatsapp',
                externalUserId: from,
                externalConvId: from,
                content: text,
              });

              await integrationService.sendWhatsAppMessage(accessToken, phoneNumberId, from, response.content);
              await integrationService.logEvent(
                integration.id, tenantId, 'whatsapp', 'message', { from },
              );
            } catch (err) {
              logger.error({ err }, 'WhatsApp message processing failed');
              await integrationService.sendWhatsAppMessage(
                accessToken, phoneNumberId, from,
                '⚠️ Sorry, I ran into an error. Please try again.',
              );
            }
          }
        }
      }
    });
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// MANAGEMENT — CRUD for integration configs (admin only)
// ═════════════════════════════════════════════════════════════════════════════

const mgmtRouter = Router();
mgmtRouter.use(authMiddleware);
mgmtRouter.use(tenantMiddleware);
mgmtRouter.use(requireRole('admin', 'super_admin'));

const createIntegrationSchema = z.object({
  platform: z.enum(['discord', 'slack', 'telegram', 'teams', 'whatsapp']),
  name: z.string().min(1).max(255),
  config: z.record(z.unknown()).default({}),
  bot_user_id: z.string().uuid().optional(),
});

const updateIntegrationSchema = z.object({
  name:    z.string().min(1).max(255).optional(),
  config:  z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

mgmtRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const integrations = await integrationService.listIntegrations(req.tenant!.id);
    res.json({ integrations });
  } catch (err) { next(err); }
});

mgmtRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createIntegrationSchema.parse(req.body);
    const integration = await integrationService.createIntegration(
      req.tenant!.id, body.platform, body.name, body.config, body.bot_user_id,
    );
    res.status(201).json(integration);
  } catch (err) { next(err); }
});

mgmtRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = updateIntegrationSchema.parse(req.body);
    const integration = await integrationService.updateIntegration(
      req.tenant!.id, req.params.id, updates,
    );
    if (!integration) throw new NotFoundError('Integration');
    res.json(integration);
  } catch (err) { next(err); }
});

mgmtRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await integrationService.deleteIntegration(req.tenant!.id, req.params.id);
    if (!deleted) throw new AppError(404, 'not_found', 'Integration not found');
    res.status(204).send();
  } catch (err) { next(err); }
});

integrationsRouter.use('/manage', mgmtRouter);

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Constant-time string comparison to prevent timing attacks */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
