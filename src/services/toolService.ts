import { query } from '../db';
import { cacheIncr } from '../cache';
import { AppError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface Tool {
  id: string;
  name: string;
  display_name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  endpoint_config: Record<string, unknown>;
  risk_level: string;
  requires_confirm: boolean;
  rate_limit: number;
  enabled: boolean;
}

export interface ToolExecution {
  id: string;
  status: string;
  output_result: Record<string, unknown> | null;
  latency_ms: number;
}

export class ToolService {
  async getTool(tenantId: string, toolId: string): Promise<Tool | null> {
    const result = await query<Tool>(
      'SELECT * FROM tools WHERE id = $1 AND tenant_id = $2 AND enabled = true',
      [toolId, tenantId]
    );
    return result.rows[0] ?? null;
  }

  async listTools(tenantId: string): Promise<Tool[]> {
    const result = await query<Tool>(
      'SELECT * FROM tools WHERE tenant_id = $1 AND enabled = true ORDER BY name',
      [tenantId]
    );
    return result.rows;
  }

  async createTool(tenantId: string, data: Partial<Tool>): Promise<Tool> {
    const result = await query<Tool>(
      `INSERT INTO tools (tenant_id, name, display_name, description, input_schema, output_schema, endpoint_config, risk_level, requires_confirm, rate_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        data.name,
        data.display_name ?? data.name,
        data.description ?? '',
        JSON.stringify(data.input_schema ?? {}),
        JSON.stringify(data.output_schema ?? {}),
        JSON.stringify(data.endpoint_config ?? {}),
        data.risk_level ?? 'low',
        data.requires_confirm ?? false,
        data.rate_limit ?? 10,
      ]
    );
    return result.rows[0];
  }

  async updateTool(tenantId: string, toolId: string, data: Partial<Tool>): Promise<Tool | null> {
    const result = await query<Tool>(
      `UPDATE tools
       SET name = COALESCE($3, name),
           display_name = COALESCE($4, display_name),
           description = COALESCE($5, description),
           input_schema = COALESCE($6, input_schema),
           endpoint_config = COALESCE($7, endpoint_config),
           risk_level = COALESCE($8, risk_level),
           requires_confirm = COALESCE($9, requires_confirm),
           rate_limit = COALESCE($10, rate_limit)
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        toolId, tenantId,
        data.name, data.display_name, data.description,
        data.input_schema ? JSON.stringify(data.input_schema) : null,
        data.endpoint_config ? JSON.stringify(data.endpoint_config) : null,
        data.risk_level, data.requires_confirm, data.rate_limit,
      ]
    );
    return result.rows[0] ?? null;
  }

  async deleteTool(tenantId: string, toolId: string): Promise<boolean> {
    const result = await query(
      'UPDATE tools SET enabled = false WHERE id = $1 AND tenant_id = $2',
      [toolId, tenantId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async checkRateLimit(tenantId: string, userId: string, toolId: string, limit: number): Promise<boolean> {
    const key = `rl:tool:${tenantId}:${userId}:${toolId}`;
    const count = await cacheIncr(key, 60);
    return count <= limit;
  }

  async executeTool(
    tenantId: string,
    conversationId: string,
    toolId: string,
    userId: string,
    inputArgs: Record<string, unknown>
  ): Promise<ToolExecution> {
    const tool = await this.getTool(tenantId, toolId);
    if (!tool) throw new NotFoundError('Tool');

    const withinLimit = await this.checkRateLimit(tenantId, userId, toolId, tool.rate_limit);
    if (!withinLimit) throw new AppError(429, 'rate_limit_exceeded', 'Tool rate limit exceeded');

    const execResult = await query<{ id: string }>(
      `INSERT INTO tool_executions (tenant_id, conversation_id, tool_id, user_id, input_args, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, conversationId, toolId, userId, JSON.stringify(inputArgs), tool.requires_confirm ? 'pending' : 'executing']
    );
    const execId = execResult.rows[0].id;

    if (tool.requires_confirm) {
      return { id: execId, status: 'pending', output_result: null, latency_ms: 0 };
    }

    const start = Date.now();
    let outputResult: Record<string, unknown>;
    let status: string;

    try {
      outputResult = await this.callToolEndpoint(tool, inputArgs);
      status = 'executed';
    } catch (err) {
      logger.error({ err, toolId }, 'Tool execution failed');
      outputResult = { error: err instanceof Error ? err.message : 'Unknown error' };
      status = 'failed';
    }

    const latency = Date.now() - start;
    await query(
      `UPDATE tool_executions SET output_result = $1, status = $2, latency_ms = $3 WHERE id = $4`,
      [JSON.stringify(outputResult), status, latency, execId]
    );

    return { id: execId, status, output_result: outputResult, latency_ms: latency };
  }

  async confirmExecution(tenantId: string, execId: string, confirmedBy: string): Promise<ToolExecution> {
    const execRes = await query<{
      id: string;
      tool_id: string;
      input_args: Record<string, unknown>;
      status: string;
    }>(
      'SELECT id, tool_id, input_args, status FROM tool_executions WHERE id = $1 AND tenant_id = $2',
      [execId, tenantId]
    );
    if (!execRes.rows[0]) throw new NotFoundError('Tool execution');
    const exec = execRes.rows[0];
    if (exec.status !== 'pending') throw new AppError(400, 'invalid_state', 'Execution not in pending state');

    await query(
      'UPDATE tool_executions SET status = $1, confirmed_by = $2 WHERE id = $3',
      ['confirmed', confirmedBy, execId]
    );

    const tool = await this.getTool(tenantId, exec.tool_id);
    if (!tool) throw new NotFoundError('Tool');

    const start = Date.now();
    let outputResult: Record<string, unknown>;
    let status: string;

    try {
      outputResult = await this.callToolEndpoint(tool, exec.input_args);
      status = 'executed';
    } catch (err) {
      outputResult = { error: err instanceof Error ? err.message : 'Unknown error' };
      status = 'failed';
    }

    const latency = Date.now() - start;
    await query(
      'UPDATE tool_executions SET output_result = $1, status = $2, latency_ms = $3 WHERE id = $4',
      [JSON.stringify(outputResult), status, latency, execId]
    );

    return { id: execId, status, output_result: outputResult, latency_ms: latency };
  }

  private async callToolEndpoint(
    tool: Tool,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const endpointConfig = tool.endpoint_config as {
      type?: string;
      url?: string;
      method?: string;
      headers?: Record<string, string>;
    };

    if (!endpointConfig.url) {
      return { mock: true, tool: tool.name, args, note: 'No endpoint configured' };
    }

    const method = (endpointConfig.method ?? 'POST').toUpperCase();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...endpointConfig.headers,
    };

    const response = await fetch(endpointConfig.url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(args) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Tool endpoint returned ${response.status}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

export const toolService = new ToolService();
