import { query } from '../db';
import { safetyService } from './safetyService';
import { knowledgeService } from './knowledgeService';
import { memoryService } from './memoryService';
import { modelRouter, ChatMessage, ModelRouterOptions } from './modelRouter';
import { toolService } from './toolService';
import { logger } from '../utils/logger';
import { Response } from 'express';
import OpenAI from 'openai';

export interface OrchestrationRequest {
  tenantId: string;
  userId: string;
  conversationId: string;
  messages: ChatMessage[];
  stream?: boolean;
  toolsEnabled?: boolean;
  knowledgeEnabled?: boolean;
  modelOptions?: ModelRouterOptions;
}

export interface OrchestrationResult {
  content: string;
  citations: Array<{ doc_id: string; title: string; url: string | null; snippet: string }>;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown>; result?: unknown }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  safetyFlags: Record<string, boolean>;
}

export class OrchestratorService {
  async process(req: OrchestrationRequest): Promise<OrchestrationResult> {
    const userMessage = req.messages[req.messages.length - 1];

    const safetyResult = safetyService.checkInput(userMessage.content);
    if (!safetyResult.safe) {
      logger.warn({ tenantId: req.tenantId, userId: req.userId }, 'Safety check failed on input');
      return {
        content: `I'm unable to process this request. ${safetyResult.reason ?? 'Policy violation detected.'}`,
        citations: [],
        toolCalls: [],
        model: 'safety-block',
        usage: { input_tokens: 0, output_tokens: 0 },
        safetyFlags: safetyResult.flags,
      };
    }

    const systemPrompt = await this.buildSystemPrompt(req);
    const memoryBlock = await memoryService.formatForPrompt(req.tenantId, req.userId);

    let citations: Array<{ doc_id: string; title: string; url: string | null; snippet: string }> = [];
    let contextBlock = '';
    if (req.knowledgeEnabled !== false) {
      const results = await knowledgeService.search(req.tenantId, userMessage.content, 5);
      citations = knowledgeService.buildCitations(results);
      contextBlock = knowledgeService.buildContextBlock(results);
    }

    let fullSystemContent = systemPrompt;
    if (memoryBlock) fullSystemContent += `\n\n${memoryBlock}`;
    if (contextBlock) fullSystemContent += `\n\n${contextBlock}`;

    const assembledMessages: ChatMessage[] = [
      { role: 'system', content: fullSystemContent },
      ...req.messages,
    ];

    let openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined;
    if (req.toolsEnabled) {
      const tools = await toolService.listTools(req.tenantId);
      if (tools.length > 0) {
        openaiTools = tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema as Record<string, unknown>,
          },
        }));
      }
    }

    const modelResult = await modelRouter.complete(assembledMessages, {
      ...req.modelOptions,
      tools: openaiTools,
    });

    const toolCallResults: Array<{ id: string; name: string; arguments: Record<string, unknown>; result?: unknown }> = [];
    if (modelResult.tool_calls && modelResult.tool_calls.length > 0) {
      for (const tc of modelResult.tool_calls) {
        try {
          const tools = await toolService.listTools(req.tenantId);
          const tool = tools.find((t) => t.name === tc.name);
          if (tool) {
            const execution = await toolService.executeTool(
              req.tenantId, req.conversationId, tool.id, req.userId, tc.arguments
            );
            toolCallResults.push({ ...tc, result: execution.output_result });
          }
        } catch (err) {
          logger.error({ err, toolName: tc.name }, 'Tool execution failed during orchestration');
          toolCallResults.push({ ...tc, result: { error: 'Tool execution failed' } });
        }
      }
    }

    const outputSafety = safetyService.checkOutput(modelResult.content);
    const finalContent = outputSafety.redactedContent ?? modelResult.content;

    await this.saveMessage(req.conversationId, req.tenantId, {
      role: 'assistant',
      content: finalContent,
      citations,
      toolCalls: toolCallResults,
      model: modelResult.model,
      tokenCountIn: modelResult.usage.input_tokens,
      tokenCountOut: modelResult.usage.output_tokens,
      safetyFlags: { ...safetyResult.flags, ...outputSafety.flags },
    });

    return {
      content: finalContent,
      citations,
      toolCalls: toolCallResults,
      model: modelResult.model,
      usage: modelResult.usage,
      safetyFlags: { ...safetyResult.flags, ...outputSafety.flags },
    };
  }

  async streamProcess(req: OrchestrationRequest, res: Response): Promise<void> {
    const userMessage = req.messages[req.messages.length - 1];

    const safetyResult = safetyService.checkInput(userMessage.content);
    if (!safetyResult.safe) {
      res.write(`data: ${JSON.stringify({ type: 'error', code: 'policy_denied', message: safetyResult.reason })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', usage: { input_tokens: 0, output_tokens: 0 } })}\n\n`);
      return;
    }

    const systemPrompt = await this.buildSystemPrompt(req);
    const memoryBlock = await memoryService.formatForPrompt(req.tenantId, req.userId);

    let citations: Array<{ doc_id: string; title: string; url: string | null; snippet: string }> = [];
    let contextBlock = '';
    if (req.knowledgeEnabled !== false) {
      const results = await knowledgeService.search(req.tenantId, userMessage.content, 5);
      citations = knowledgeService.buildCitations(results);
      contextBlock = knowledgeService.buildContextBlock(results);

      for (const citation of citations) {
        res.write(`data: ${JSON.stringify({ type: 'citation', ...citation })}\n\n`);
      }
    }

    let fullSystemContent = systemPrompt;
    if (memoryBlock) fullSystemContent += `\n\n${memoryBlock}`;
    if (contextBlock) fullSystemContent += `\n\n${contextBlock}`;

    const assembledMessages: ChatMessage[] = [
      { role: 'system', content: fullSystemContent },
      ...req.messages,
    ];

    const usage = await modelRouter.streamToResponse(assembledMessages, req.modelOptions ?? {}, res);

    res.write(`data: ${JSON.stringify({ type: 'done', usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } })}\n\n`);
  }

  private async buildSystemPrompt(req: OrchestrationRequest): Promise<string> {
    return [
      'You are a helpful enterprise AI assistant.',
      'Be accurate, professional, and concise.',
      'When citing information from documents, reference the source.',
      'Do not make up information. If you do not know, say so.',
      `Tenant ID: ${req.tenantId}`,
    ].join('\n');
  }

  private async saveMessage(
    conversationId: string,
    tenantId: string,
    data: {
      role: string;
      content: string;
      citations: unknown[];
      toolCalls: unknown[];
      model: string;
      tokenCountIn: number;
      tokenCountOut: number;
      safetyFlags: Record<string, boolean>;
    }
  ): Promise<void> {
    await query(
      `INSERT INTO messages (conversation_id, tenant_id, role, content, citations, tool_calls, model_used, token_count_in, token_count_out, safety_flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        conversationId,
        tenantId,
        data.role,
        data.content,
        JSON.stringify(data.citations),
        JSON.stringify(data.toolCalls),
        data.model,
        data.tokenCountIn,
        data.tokenCountOut,
        JSON.stringify(data.safetyFlags),
      ]
    );
  }
}

export const orchestratorService = new OrchestratorService();
