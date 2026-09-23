import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createListingImageUploadFiles,
  createUploadableImageFile,
} from '@/lib/client-image-normalization';

test('falls back to the original upload file when browser-side image normalization is unavailable', async () => {
  const file = new File(['not decoded in node'], 'listing-photo.jpg', {
    type: 'image/jpeg',
  });

  const uploadableFile = await createUploadableImageFile(file);

  assert.equal(uploadableFile, file);
});

test('falls back to a single original file for listing image variants in node', async () => {
  const file = new File(['not decoded in node'], 'listing-photo.jpg', {
    type: 'image/jpeg',
  });

  const uploadFiles = await createListingImageUploadFiles(file);

  assert.equal(uploadFiles.original, file);
  assert.equal(uploadFiles.display, null);
  assert.equal(uploadFiles.thumbnail, null);
});
