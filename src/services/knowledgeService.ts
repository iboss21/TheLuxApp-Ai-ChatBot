import OpenAI from 'openai';
import { query } from '../db';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  url: string | null;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface Citation {
  doc_id: string;
  title: string;
  url: string | null;
  snippet: string;
}

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

export class KnowledgeService {
  async embedQuery(text: string): Promise<number[]> {
    if (!config.openai.apiKey) {
      logger.warn('OpenAI API key not set, returning mock embedding');
      return new Array(1536).fill(0).map(() => Math.random() - 0.5);
    }
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-ada-002',
      input: text,
    });
    return response.data[0].embedding;
  }

  async search(
    tenantId: string,
    queryText: string,
    topK = 5,
    userGroups: string[] = []
  ): Promise<SearchResult[]> {
    let embedding: number[];
    try {
      embedding = await this.embedQuery(queryText);
    } catch (err) {
      logger.error({ err }, 'Failed to embed query');
      return [];
    }

    const embeddingStr = `[${embedding.join(',')}]`;

    const aclFilter = userGroups.length > 0
      ? `AND (d.sensitivity = 'public' OR d.acl_groups && $3::text[])`
      : `AND d.sensitivity IN ('public', 'internal')`;

    const params: unknown[] = [tenantId, embeddingStr];
    if (userGroups.length > 0) params.push(userGroups);

    const sql = `
      SELECT
        dc.id as chunk_id,
        dc.document_id,
        dc.content,
        dc.metadata as chunk_metadata,
        d.title,
        d.url,
        d.metadata as doc_metadata,
        1 - (dc.embedding <=> $2::vector) as score
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE dc.tenant_id = $1
        ${aclFilter}
      ORDER BY dc.embedding <=> $2::vector
      LIMIT ${topK}
    `;

    try {
      const result = await query<{
        chunk_id: string;
        document_id: string;
        content: string;
        chunk_metadata: Record<string, unknown>;
        title: string;
        url: string | null;
        doc_metadata: Record<string, unknown>;
        score: number;
      }>(sql, params);

      return result.rows.map((row) => ({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        title: row.title,
        url: row.url,
        content: row.content,
        score: row.score,
        metadata: { ...row.chunk_metadata, ...row.doc_metadata },
      }));
    } catch (err) {
      logger.error({ err }, 'Vector search failed');
      return [];
    }
  }

  buildCitations(results: SearchResult[]): Citation[] {
    return results.map((r) => ({
      doc_id: r.documentId,
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
    }));
  }

  buildContextBlock(results: SearchResult[]): string {
    if (results.length === 0) return '';
    const sections = results.map((r, i) =>
      `[${i + 1}] ${r.title}\n${r.content}`
    );
    return `Relevant context:\n\n${sections.join('\n\n---\n\n')}`;
  }
}

export const knowledgeService = new KnowledgeService();
