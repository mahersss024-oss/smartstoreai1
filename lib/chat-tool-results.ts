export type AssistantSearchToolName =
  | 'searchMarketplaceListings'
  | 'compareMarketplaceListings';

export type AssistantSearchToolOutput = {
  status: 'searched' | 'compared';
  listings: unknown[];
  [key: string]: unknown;
};

export type AssistantSearchToolResult = {
  toolCallId: string;
  toolName: AssistantSearchToolName;
  input: unknown;
  output: AssistantSearchToolOutput;
};

const assistantSearchToolNames = new Set<AssistantSearchToolName>([
  'searchMarketplaceListings',
  'compareMarketplaceListings',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isAssistantSearchToolName(
  value: unknown,
): value is AssistantSearchToolName {
  return (
    typeof value === 'string' &&
    assistantSearchToolNames.has(value as AssistantSearchToolName)
  );
}

export function isAssistantSearchToolOutput(
  value: unknown,
): value is AssistantSearchToolOutput {
  return (
    isRecord(value) &&
    (value.status === 'searched' || value.status === 'compared') &&
    Array.isArray(value.listings)
  );
}

export function extractAssistantSearchToolResults(
  generationResult: unknown,
): AssistantSearchToolResult[] {
  if (!isRecord(generationResult)) {
    return [];
  }

  const rawToolResults = [
    ...asArray(generationResult.staticToolResults),
    ...asArray(generationResult.toolResults),
  ];
  const results: AssistantSearchToolResult[] = [];
  const seenToolCalls = new Set<string>();

  for (let index = 0; index < rawToolResults.length; index += 1) {
    const toolResult = rawToolResults[index];

    if (!isRecord(toolResult)) {
      continue;
    }

    if (!isAssistantSearchToolName(toolResult.toolName)) {
      continue;
    }

    if (!isAssistantSearchToolOutput(toolResult.output)) {
      continue;
    }

    const toolCallId =
      typeof toolResult.toolCallId === 'string' && toolResult.toolCallId
        ? toolResult.toolCallId
        : `assistant-search-${toolResult.toolName}-${index}`;
    const dedupeKey = `${toolCallId}:${toolResult.toolName}`;

    if (seenToolCalls.has(dedupeKey)) {
      continue;
    }

    seenToolCalls.add(dedupeKey);
    results.push({
      toolCallId,
      toolName: toolResult.toolName,
      input: 'input' in toolResult ? toolResult.input : {},
      output: toolResult.output,
    });
  }

  return results;
}
