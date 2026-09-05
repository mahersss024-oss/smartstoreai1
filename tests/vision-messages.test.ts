import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  dataUrlToBytes,
  normalizeModelMessageFileData,
  stripImageAttachmentsFromModelMessages,
} from '@/agent/vision-messages';

test('converts image data URLs into bytes for model messages', () => {
  const converted = dataUrlToBytes('data:image/png;base64,SGVsbG8=');

  assert.equal(converted?.mediaType, 'image/png');
  assert.deepEqual([...converted?.data ?? []], [72, 101, 108, 108, 111]);
});

test('normalizes model file parts from data URLs and hosted URLs', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: 'data:image/jpeg;base64,AAE=',
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'https://example.com/product.png',
        },
      ],
    },
  ];

  const [message] = normalizeModelMessageFileData(messages);
  const content = Array.isArray(message.content) ? message.content : [];
  const dataUrlPart = content[0] as { data: unknown; mediaType: string };
  const hostedUrlPart = content[1] as { data: unknown; mediaType: string };

  assert.equal(dataUrlPart.mediaType, 'image/jpeg');
  assert.ok(dataUrlPart.data instanceof Uint8Array);
  assert.ok(hostedUrlPart.data instanceof URL);
});

test('strips image file parts before text-only chat model calls', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'افحص هذه السيارة' },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: new Uint8Array([1, 2, 3]),
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([7, 8, 9]),
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([4, 5, 6]),
        },
      ],
    },
  ];

  const stripped = stripImageAttachmentsFromModelMessages(messages);

  assert.equal(stripped.length, 1);
  assert.deepEqual(stripped[0], {
    role: 'user',
    content: [{ type: 'text', text: 'افحص هذه السيارة' }],
  });
});
