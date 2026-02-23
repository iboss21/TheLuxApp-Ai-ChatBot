import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ModelRouterOptions {
  provider?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAI.Chat.ChatCompletionTool[];
}

export interface ModelResponse {
  content: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export class ModelRouter {
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;

  private getOpenAI(): OpenAI {
    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return this.openaiClient;
  }

  private getAnthropic(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({ apiKey: config.anthropic.apiKey });
    }
    return this.anthropicClient;
  }

  async complete(
    messages: ChatMessage[],
    options: ModelRouterOptions = {}
  ): Promise<ModelResponse> {
    const provider = options.provider ?? config.defaultProvider;
    const model = options.model ?? config.defaultModel;

    logger.debug({ provider, model }, 'Model router: completing');

    if (provider === 'anthropic') {
      return this.callAnthropic(messages, { ...options, model });
    }
    return this.callOpenAI(messages, { ...options, model });
  }

  async streamToResponse(
    messages: ChatMessage[],
    options: ModelRouterOptions,
    res: Response
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const provider = options.provider ?? config.defaultProvider;
    const model = options.model ?? config.defaultModel;

    if (provider === 'anthropic') {
      return this.streamAnthropicToResponse(messages, { ...options, model }, res);
    }
    return this.streamOpenAIToResponse(messages, { ...options, model }, res);
  }

  private async callOpenAI(messages: ChatMessage[], options: ModelRouterOptions): Promise<ModelResponse> {
    const client = this.getOpenAI();
    const openaiMessages = messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

    const response = await client.chat.completions.create({
      model: options.model ?? config.defaultModel,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      tools: options.tools,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      model: response.model,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
      tool_calls: toolCalls,
    };
  }

  private async callAnthropic(messages: ChatMessage[], options: ModelRouterOptions): Promise<ModelResponse> {
    const client = this.getAnthropic();
    const systemMessage = messages.find((m) => m.role === 'system')?.content;
    const filteredMessages = messages.filter((m) => m.role !== 'system' && m.role !== 'tool');

    const response = await client.messages.create({
      model: options.model ?? 'claude-3-opus-20240229',
      max_tokens: options.maxTokens ?? 2048,
      system: systemMessage,
      messages: filteredMessages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }

  private async streamOpenAIToResponse(
    messages: ChatMessage[],
    options: ModelRouterOptions,
    res: Response
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const client = this.getOpenAI();
    const openaiMessages = messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

    const stream = await client.chat.completions.create({
      model: options.model ?? config.defaultModel,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      stream: true,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        res.write(`data: ${JSON.stringify({ type: 'token', content: delta.content })}\n\n`);
        outputTokens++;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    return { inputTokens, outputTokens };
  }

  private async streamAnthropicToResponse(
    messages: ChatMessage[],
    options: ModelRouterOptions,
    res: Response
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const client = this.getAnthropic();
    const systemMessage = messages.find((m) => m.role === 'system')?.content;
    const filteredMessages = messages.filter((m) => m.role !== 'system' && m.role !== 'tool');

    const stream = client.messages.stream({
      model: options.model ?? 'claude-3-opus-20240229',
      max_tokens: options.maxTokens ?? 2048,
      system: systemMessage,
      messages: filteredMessages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'token', content: event.delta.text })}\n\n`);
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens;
      }
      if (event.type === 'message_start' && event.message.usage) {
        inputTokens = event.message.usage.input_tokens;
      }
    }

    return { inputTokens, outputTokens };
  }
}

export const modelRouter = new ModelRouter();
