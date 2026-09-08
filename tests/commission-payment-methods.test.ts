import assert from 'node:assert/strict';
import test from 'node:test';

import { getCommissionPaymentMethods } from '@/agent/marketplace/commission-payment-methods';

test('hides commission payment methods without configured recipient details', () => {
  assert.deepEqual(getCommissionPaymentMethods({}), []);
});

test('returns configured commission payment methods only', () => {
  const methods = getCommissionPaymentMethods({
    SMARTSTORE_COMMISSION_ALRAJHI_ACCOUNT_NAME: 'SmartStore AI',
    SMARTSTORE_COMMISSION_ALRAJHI_ACCOUNT_NUMBER: '1234567890',
    SMARTSTORE_COMMISSION_SNB_IBAN: 'SA0000000000000000000000',
    SMARTSTORE_COMMISSION_STC_PAY_NUMBER: '0500000000',
  });

  assert.equal(methods.length, 3);
  assert.equal(methods[0]?.id, 'alrajhi');
  assert.equal(methods[0]?.fields.length, 2);
  assert.equal(methods[1]?.id, 'snb');
  assert.equal(methods[1]?.fields[0]?.label, 'IBAN');
  assert.equal(methods[2]?.id, 'stc-pay');
  assert.equal(methods[2]?.fields[0]?.value, '0500000000');
});

test('trims commission payment values before returning them', () => {
  const methods = getCommissionPaymentMethods({
    SMARTSTORE_COMMISSION_STC_PAY_NAME: '  SmartStore AI  ',
  });

  assert.equal(methods[0]?.fields[0]?.value, 'SmartStore AI');
  assert.equal(methods[0]?.fields[0]?.copyValue, 'SmartStore AI');
});
