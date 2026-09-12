import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeContactPhoneNumber } from '@/lib/auth/contact-profile';

test('normalizes Saudi mobile phone formats for account profiles', () => {
  assert.deepEqual(normalizeContactPhoneNumber('055 123 4567'), {
    ok: true,
    phoneNumber: '+966551234567',
  });
  assert.deepEqual(normalizeContactPhoneNumber('+966-55-123-4567'), {
    ok: true,
    phoneNumber: '+966551234567',
  });
  assert.deepEqual(normalizeContactPhoneNumber('00966551234567'), {
    ok: true,
    phoneNumber: '+966551234567',
  });
});

test('normalizes Arabic digits and allows clearing contact phone', () => {
  assert.deepEqual(normalizeContactPhoneNumber('٠٥٥١٢٣٤٥٦٧'), {
    ok: true,
    phoneNumber: '+966551234567',
  });
  assert.deepEqual(normalizeContactPhoneNumber('   '), {
    ok: true,
    phoneNumber: null,
  });
});

test('rejects invalid account profile phone numbers', () => {
  const result = normalizeContactPhoneNumber('12345');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /رقم جوال سعودي صحيح/);
  }
});

test('rejects multiple saved contact phone numbers', () => {
  const result = normalizeContactPhoneNumber('0501234567 0551234567');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /رقم تواصل رسمي واحد/);
  }
});
