import type { ModelMessage } from 'ai';

const dataUrlPattern = /^data:([^;,]+);base64,([\s\S]+)$/i;

type ModelFilePart = {
  type: 'file';
  data: unknown;
  mediaType: string;
};

function isModelFilePart(part: unknown): part is ModelFilePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    'data' in part &&
    'mediaType' in part &&
    (part as { type?: unknown }).type === 'file' &&
    typeof (part as { mediaType?: unknown }).mediaType === 'string'
  );
}

function tryCreateUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function dataUrlToBytes(value: string) {
  const match = value.match(dataUrlPattern);

  if (!match) {
    return null;
  }

  return {
    mediaType: match[1],
    data: Uint8Array.from(Buffer.from(match[2].replace(/\s/g, ''), 'base64')),
  };
}

function normalizeFilePartData(part: ModelFilePart) {
  if (typeof part.data !== 'string') {
    return part;
  }

  const dataUrl = dataUrlToBytes(part.data);

  if (dataUrl) {
    return {
      ...part,
      mediaType: dataUrl.mediaType || part.mediaType,
      data: dataUrl.data,
    };
  }

  const url = tryCreateUrl(part.data);

  return url ? { ...part, data: url } : part;
}

export function normalizeModelMessageFileData(messages: ModelMessage[]) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part) =>
        isModelFilePart(part) ? normalizeFilePartData(part) : part,
      ),
    };
  }) as ModelMessage[];
}
