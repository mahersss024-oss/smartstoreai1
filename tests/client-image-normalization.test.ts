import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  createListingImageUploadFiles,
  createUploadableImageFile,
  prepareUploadableImageFiles,
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

test('prepares multiple listing images while preserving their selected order', async () => {
  const files = ['one', 'two', 'three'].map(
    (name) => new File([name], `${name}.jpg`, { type: 'image/jpeg' }),
  );

  const preparedFiles = await prepareUploadableImageFiles(files, 2);

  assert.deepEqual(preparedFiles, files);
});

test('one unconvertible image does not discard other prepared files', async () => {
  const first = new File(['one'], 'one.jpg', { type: 'image/jpeg' });
  const unsupported = new File(['bad'], 'bad.heic', { type: 'image/heic' });
  const last = new File(['last'], 'last.png', { type: 'image/png' });
  assert.deepEqual(await prepareUploadableImageFiles([first, unsupported, last]), [first, last]);
});

test('chat image preparation starts when mobile files are selected, before submit', () => {
  const promptInput = readFileSync(
    join(process.cwd(), 'components', 'chat-elements', 'prompt-input.tsx'),
    'utf8',
  );

  assert.match(promptInput, /createPromptInputAttachments\(capped\)/);
  assert.match(promptInput, /preparation\?: Promise/);
  assert.match(promptInput, /\(await item\.preparation\) \?\?/);
});
