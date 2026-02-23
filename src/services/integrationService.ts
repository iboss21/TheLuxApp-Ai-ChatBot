import crypto from 'crypto';
import { query } from '../db';
import { orchestratorService } from './orchestrator';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrationConfig {
  id: string;
  tenant_id: string;
  platform: string;
  name: string;
  config: Record<string, unknown>;
  bot_user_id: string | null;
  enabled: boolean;
  created_at?: string;
}

export interface PlatformMessageRequest {
  integrationId: string;
  tenantId: string;
  platform: string;
  externalUserId: string;
  externalConvId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformResponse {
  content: string;
  citations: Array<{ title: string; url: string | null }>;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class IntegrationService {

  // ── Signature Verification ─────────────────────────────────────────────────

  /**
   * Verify Discord interaction request using Ed25519 signature.
   * Discord docs: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
   */
  verifyDiscordSignature(
    publicKey: string,
    signature: string,
    timestamp: string,
    rawBody: string,
  ): boolean {
    try {
      const verify = crypto.createVerify('ED25519');
      verify.update(Buffer.from(timestamp + rawBody));
      return verify.verify(
        Buffer.from(publicKey, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch (err) {
      logger.warn({ err }, 'Discord signature verification error');
      return false;
    }
  }

  /**
   * Verify Slack request using HMAC-SHA256 signing secret.
   * Slack docs: https://api.slack.com/authentication/verifying-requests-from-slack
   */
  verifySlackSignature(
    signingSecret: string,
    signature: string,
    timestamp: string,
    rawBody: string,
  ): boolean {
    try {
      // Reject requests older than 5 minutes to prevent replay attacks
      const reqTime = parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - reqTime) > 300) return false;

      const baseStr = `v0:${timestamp}:${rawBody}`;
      const hmac = crypto.createHmac('sha256', signingSecret);
      hmac.update(baseStr);
      const expected = `v0=${hmac.digest('hex')}`;
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf-8'),
        Buffer.from(expected, 'utf-8'),
      );
    } catch (err) {
      logger.warn({ err }, 'Slack signature verification error');
      return false;
    }
  }

  /**
   * Verify WhatsApp webhook challenge during subscription setup.
   * Meta docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
   */
  verifyWhatsAppChallenge(verifyToken: string, mode: string, token: string): boolean {
    return mode === 'subscribe' && crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(verifyToken),
    );
  }

  // ── User / Conversation Resolution ────────────────────────────────────────

  /**
   * Map an external platform user ID to an internal user, creating one if needed.
   */
  async resolveUser(
    integrationId: string,
    tenantId: string,
    externalUserId: string,
    displayName?: string,
  ): Promise<string> {
    const existing = await query<{ internal_user_id: string }>(
      `SELECT internal_user_id FROM integration_user_map
       WHERE integration_id = $1 AND external_user_id = $2`,
      [integrationId, externalUserId],
    );
    if (existing.rows.length > 0) return existing.rows[0].internal_user_id;

    // Create a shadow user for this platform identity
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (tenant_id, external_id, display_name, role, metadata)
       VALUES ($1, $2, $3, 'user', $4)
       RETURNING id`,
      [
        tenantId,
        `integration:${integrationId}:${externalUserId}`,
        displayName ?? `User ${externalUserId}`,
        JSON.stringify({ integration_id: integrationId, external_user_id: externalUserId }),
      ],
    );
    const internalUserId = userResult.rows[0].id;

    await query(
      `INSERT INTO integration_user_map (integration_id, external_user_id, internal_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (integration_id, external_user_id) DO NOTHING`,
      [integrationId, externalUserId, internalUserId],
    );
    return internalUserId;
  }

  /**
   * Map an external channel/thread/chat ID to an internal conversation.
   */
  async resolveConversation(
    integrationId: string,
    tenantId: string,
    userId: string,
    externalConvId: string,
    channel: string,
  ): Promise<string> {
    const existing = await query<{ internal_conv_id: string }>(
      `SELECT internal_conv_id FROM integration_conversation_map
       WHERE integration_id = $1 AND external_conv_id = $2`,
      [integrationId, externalConvId],
    );
    if (existing.rows.length > 0) return existing.rows[0].internal_conv_id;

    const convResult = await query<{ id: string }>(
      `INSERT INTO conversations (tenant_id, user_id, channel, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        tenantId,
        userId,
        channel,
        JSON.stringify({ integration_id: integrationId, external_conv_id: externalConvId }),
      ],
    );
    const internalConvId = convResult.rows[0].id;

    await query(
      `INSERT INTO integration_conversation_map (integration_id, external_conv_id, internal_conv_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (integration_id, external_conv_id) DO NOTHING`,
      [integrationId, externalConvId, internalConvId],
    );
    return internalConvId;
  }

  // ── Core Message Processing ───────────────────────────────────────────────

  /**
   * Resolve user + conversation, then run the message through the AI orchestrator.
   * This is the single unified entry point for all platform messages.
   */
  async processMessage(req: PlatformMessageRequest): Promise<PlatformResponse> {
    const userId = await this.resolveUser(
      req.integrationId, req.tenantId, req.externalUserId,
      req.metadata?.displayName as string | undefined,
    );
    const conversationId = await this.resolveConversation(
      req.integrationId, req.tenantId, userId, req.externalConvId, req.platform,
    );

    const result = await orchestratorService.process({
      tenantId: req.tenantId,
      userId,
      conversationId,
      messages: [{ role: 'user', content: req.content }],
      toolsEnabled: true,
      knowledgeEnabled: true,
    });

    return {
      content: result.content,
      citations: result.citations.map((c) => ({ title: c.title, url: c.url })),
    };
  }

  // ── Integration Lookup ────────────────────────────────────────────────────

  async findIntegration(platform: string, tenantId: string): Promise<IntegrationConfig | null> {
    const result = await query<IntegrationConfig>(
      `SELECT id, tenant_id, platform, name, config, bot_user_id, enabled
       FROM platform_integrations
       WHERE platform = $1 AND tenant_id = $2 AND enabled = true
       LIMIT 1`,
      [platform, tenantId],
    );
    return result.rows[0] ?? null;
  }

  async listIntegrations(tenantId: string): Promise<IntegrationConfig[]> {
    const result = await query<IntegrationConfig>(
      `SELECT id, tenant_id, platform, name, enabled, created_at
       FROM platform_integrations
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows;
  }

  async createIntegration(
    tenantId: string,
    platform: string,
    name: string,
    cfg: Record<string, unknown>,
    botUserId?: string,
  ): Promise<IntegrationConfig> {
    const result = await query<IntegrationConfig>(
      `INSERT INTO platform_integrations (tenant_id, platform, name, config, bot_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, platform, name, enabled, created_at`,
      [tenantId, platform, name, JSON.stringify(cfg), botUserId ?? null],
    );
    return result.rows[0];
  }

  async updateIntegration(
    tenantId: string,
    integrationId: string,
    updates: { name?: string; config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<IntegrationConfig | null> {
    const result = await query<IntegrationConfig>(
      `UPDATE platform_integrations
       SET name    = COALESCE($3, name),
           config  = COALESCE($4, config),
           enabled = COALESCE($5, enabled),
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id, platform, name, enabled, created_at`,
      [
        integrationId, tenantId,
        updates.name ?? null,
        updates.config ? JSON.stringify(updates.config) : null,
        updates.enabled ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async deleteIntegration(tenantId: string, integrationId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM platform_integrations WHERE id = $1 AND tenant_id = $2',
      [integrationId, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ── Platform-Specific Senders ─────────────────────────────────────────────

  /** Send a message via Telegram Bot API */
  async sendTelegramMessage(botToken: string, chatId: string | number, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Telegram sendMessage failed');
    }
  }

  /** Post a message via Slack Web API */
  async postSlackMessage(botToken: string, channel: string, text: string): Promise<void> {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel, text, mrkdwn: true }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Slack postMessage failed');
    }
  }

  /** Send a message via WhatsApp Cloud API */
  async sendWhatsAppMessage(
    accessToken: string,
    phoneNumberId: string,
    to: string,
    text: string,
  ): Promise<void> {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'WhatsApp sendMessage failed');
    }
  }

  /** Reply to a Discord interaction with a follow-up message (after deferral) */
  async patchDiscordInteraction(
    applicationId: string,
    interactionToken: string,
    content: string,
  ): Promise<void> {
    const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Discord follow-up message failed');
    }
  }

  /** Log an integration event for auditing */
  async logEvent(
    integrationId: string,
    tenantId: string,
    platform: string,
    eventType: string,
    payload: Record<string, unknown>,
    error?: string,
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO integration_events
           (integration_id, tenant_id, platform, event_type, payload, processed, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [integrationId, tenantId, platform, eventType, JSON.stringify(payload), !error, error ?? null],
      );
    } catch (err) {
      logger.error({ err }, 'Failed to log integration event');
    }
  }
}

export const integrationService = new IntegrationService();
