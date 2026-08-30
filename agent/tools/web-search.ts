import { tool } from 'ai';
import { z } from 'zod';

type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
};

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
};

type TavilySearchResponse = {
  answer?: unknown;
  results?: unknown;
};

function getTavilyApiKey() {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is missing. Add it to .env.local to enable web search.',
    );
  }

  return apiKey;
}

function isTavilyResult(result: unknown): result is TavilyResult {
  return typeof result === 'object' && result !== null;
}

function normalizeResult(result: unknown): WebSearchResult | null {
  if (!isTavilyResult(result)) {
    return null;
  }

  if (
    typeof result.title !== 'string' ||
    typeof result.url !== 'string' ||
    typeof result.content !== 'string'
  ) {
    return null;
  }

  return {
    title: result.title,
    url: result.url,
    content: result.content,
    score: typeof result.score === 'number' ? result.score : undefined,
    publishedDate:
      typeof result.published_date === 'string'
        ? result.published_date
        : undefined,
  };
}

export const searchWeb = tool({
  description:
    'Search the live web for general current information, company pages, API docs, service regions, documentation, news, and facts that may have changed.',
  inputSchema: z.object({
    query: z.string().min(2).describe('Natural-language web search query'),
    topic: z
      .enum(['general', 'news', 'finance'])
      .optional()
      .describe('Search category. Use news for recent news, finance for markets, otherwise general.'),
    searchDepth: z
      .enum(['basic', 'advanced'])
      .optional()
      .describe('Use advanced only when the question needs deeper research.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Maximum number of web results to return.'),
  }),
  execute: async ({
    query,
    topic = 'general',
    searchDepth = 'basic',
    maxResults = 5,
  }) => {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getTavilyApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        topic,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Web search failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as TavilySearchResponse;
    const results = Array.isArray(data.results)
      ? data.results
          .map(normalizeResult)
          .filter((result): result is WebSearchResult => Boolean(result))
      : [];

    return {
      query,
      answer: typeof data.answer === 'string' ? data.answer : undefined,
      results,
    };
  },
});
