import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  createPersistentImageDataUrl,
  extractLatestUploadedListingImages,
} from '@/agent/marketplace/listing-image-storage';

test('extracts the latest uploaded product images from prior chat context', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'للنشر كرسي مكتب في تبوك' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([1, 2, 3]),
          filename: 'chair.png',
        },
      ],
    },
    {
      role: 'assistant',
      content: 'الصورة مناسبة، هل تعتمد الإعلان؟',
    },
    {
      role: 'user',
      content: [{ type: 'text', text: 'اعتمد الإعلان' }],
    },
  ];

  const images = extractLatestUploadedListingImages(messages);
  const image = images[0];

  assert.equal(images.length, 1);
  assert.ok(image);
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.fileName, 'chair.png');
  assert.deepEqual([...image.data], [1, 2, 3]);
});

test('ignores unsupported image payloads', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/gif',
          data: new Uint8Array([1]),
        },
      ],
    },
  ];

  assert.deepEqual(extractLatestUploadedListingImages(messages), []);
});

test('creates a persistent image data URL for database-backed listings', () => {
  const url = createPersistentImageDataUrl(
    new Uint8Array([1, 2, 3]),
    'image/png',
  );

  assert.equal(url, 'data:image/png;base64,AQID');
});
