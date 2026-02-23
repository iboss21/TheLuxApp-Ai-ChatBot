import { query } from '../db';

export interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  consent_given: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export class MemoryService {
  async getUserMemory(tenantId: string, userId: string): Promise<MemoryEntry[]> {
    const result = await query<MemoryEntry>(
      `SELECT id, category, key, value, consent_given, expires_at, created_at, updated_at
       FROM user_memory
       WHERE tenant_id = $1 AND user_id = $2
         AND consent_given = true
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY updated_at DESC`,
      [tenantId, userId]
    );
    return result.rows;
  }

  async upsertMemory(
    tenantId: string,
    userId: string,
    category: string,
    key: string,
    value: string
  ): Promise<MemoryEntry> {
    const result = await query<MemoryEntry>(
      `INSERT INTO user_memory (tenant_id, user_id, category, key, value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id, category, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING *`,
      [tenantId, userId, category, key, value]
    );
    return result.rows[0];
  }

  async updateMemory(
    tenantId: string,
    userId: string,
    memoryId: string,
    value: string
  ): Promise<MemoryEntry | null> {
    const result = await query<MemoryEntry>(
      `UPDATE user_memory
       SET value = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3 AND user_id = $4
       RETURNING *`,
      [value, memoryId, tenantId, userId]
    );
    return result.rows[0] ?? null;
  }

  async deleteMemory(tenantId: string, userId: string, memoryId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM user_memory WHERE id = $1 AND tenant_id = $2 AND user_id = $3',
      [memoryId, tenantId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteAllMemory(tenantId: string, userId: string): Promise<number> {
    const result = await query(
      'DELETE FROM user_memory WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId]
    );
    return result.rowCount ?? 0;
  }

  async setConsent(tenantId: string, userId: string, consentGiven: boolean): Promise<void> {
    await query(
      'UPDATE user_memory SET consent_given = $1 WHERE tenant_id = $2 AND user_id = $3',
      [consentGiven, tenantId, userId]
    );
  }

  async formatForPrompt(tenantId: string, userId: string): Promise<string> {
    const memories = await this.getUserMemory(tenantId, userId);
    if (memories.length === 0) return '';
    const lines = memories.map((m) => `- [${m.category}] ${m.key}: ${m.value}`);
    return `User memories:\n${lines.join('\n')}`;
  }
}

export const memoryService = new MemoryService();
