import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RecordDetails,
  TechnicalDetails,
  displayValue,
  evidenceEventLabel,
} from '@/components/admin/record-details';

test('administrative records translate known fields without changing free text', () => {
  assert.equal(displayValue('used', 'condition'), 'مستعمل');
  assert.equal(displayValue('published', 'status'), 'منشور');
  assert.equal(displayValue('published', 'description'), 'published');
  assert.equal(
    displayValue('2026-10-17T10:00:00Z', 'description'),
    '2026-10-17T10:00:00Z',
  );
  assert.equal(displayValue('admin', 'reason'), 'admin');
  assert.equal(displayValue(false), 'لا');
  assert.equal(displayValue(null), 'غير مسجل');
  const html = renderToStaticMarkup(
    createElement(RecordDetails, {
      value: {
        title: 'إعلان محفوظ',
        description: 'published',
        status: 'published',
        id: 'original-record-id',
      },
    }),
  );
  assert.match(html, /إعلان محفوظ/);
  assert.match(html, /منشور/);
  assert.match(html, /published/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /original-record-id/);
});

test('technical source data remains available and safely escaped', () => {
  const value = {
    hash: 'a'.repeat(64),
    unknownKey: '<script>alert(1)</script>',
  };
  const html = renderToStaticMarkup(createElement(TechnicalDetails, { value }));
  assert.match(html, /a{64}/);
  assert.match(html, /unknownKey/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /dir="ltr"/);
  assert.doesNotMatch(html, /\sopen=/);
});

test('unknown fields and event types are preserved without fabricated descriptions', () => {
  const html = renderToStaticMarkup(
    createElement(RecordDetails, {
      value: JSON.parse('{"constructor":"source","nestedUnknown":{"x":1}}'),
    }),
  );
  assert.match(html, /constructor/);
  assert.match(html, /nestedUnknown/);
  assert.equal(evidenceEventLabel('asset.viewed'), 'عرض صورة محفوظة');
  assert.equal(evidenceEventLabel('evidence_retry'), 'إعادة محاولة حفظ الصور');
  assert.equal(
    evidenceEventLabel('unknown.operation'),
    'إجراء مسجّل في القضية',
  );
  assert.equal(evidenceEventLabel('constructor'), 'إجراء مسجّل في القضية');
});

test('nested and empty evidence data render without losing original fields', () => {
  const html = renderToStaticMarkup(
    createElement(RecordDetails, {
      value: {
        before: { status: 'open' },
        after: { status: 'reviewed' },
        participants: [{ name: 'ماهر', phoneNumber: null }],
        commissions: [],
      },
    }),
  );
  assert.match(html, /قبل الإجراء/);
  assert.match(html, /بعد الإجراء/);
  assert.match(html, /ماهر/);
  assert.match(html, /غير مسجل/);
});
