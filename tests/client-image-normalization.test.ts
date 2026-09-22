import assert from 'node:assert/strict';
import test from 'node:test';

import { createUploadableImageFile } from '@/lib/client-image-normalization';

test('falls back to the original upload file when browser-side image normalization is unavailable', async () => {
  const file = new File(['not decoded in node'], 'listing-photo.jpg', {
    type: 'image/jpeg',
  });

  const uploadableFile = await createUploadableImageFile(file);

  assert.equal(uploadableFile, file);
});
