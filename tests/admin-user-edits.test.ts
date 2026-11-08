import assert from 'node:assert/strict';
import test from 'node:test';
import { commitUserEdit, createUserDraft, reconcileUserEdit, userEditIsDirty } from '@/components/admin/user-edits';

test('user refresh retains an edited phone and adopts an unrelated server role update', () => {
  const original = createUserDraft({ role: 'user', phoneNumber: '0500000000' });
  const edit = reconcileUserEdit(undefined, original);
  edit.draft = { ...edit.draft, phoneNumber: '0511111111' };
  const next = reconcileUserEdit(edit, { ...original, role: 'moderator' });
  assert.deepEqual(next.draft, { role: 'moderator', phoneNumber: '0511111111' });
  assert.deepEqual(next.base, { role: 'moderator', phoneNumber: '0500000000' });
  assert.deepEqual(next.conflicts, []);
  assert.equal(userEditIsDirty(next), true);
});

test('same-field user changes remain reviewable across repeated server refreshes', () => {
  const edit = reconcileUserEdit(undefined, { role: 'user', phoneNumber: '0500000000' });
  edit.draft = { ...edit.draft, phoneNumber: '0511111111' };
  const incoming = { role: 'user' as const, phoneNumber: '0522222222' };
  const next = reconcileUserEdit(edit, incoming);
  assert.deepEqual(next.conflicts, ['phoneNumber']);
  assert.deepEqual(reconcileUserEdit(next, incoming).conflicts, ['phoneNumber']);
  assert.deepEqual(reconcileUserEdit({ ...next, conflicts: [] }, incoming).conflicts, []);
  assert.equal(reconcileUserEdit(next, incoming).draft.phoneNumber, '0511111111');
});

test('saving or clearing only the user phone preserves a pending role and canonical server values', () => {
  const edit = reconcileUserEdit(undefined, { role: 'user', phoneNumber: '0500000000' });
  edit.draft = { role: 'moderator', phoneNumber: '0511111111' };
  const saved = commitUserEdit(edit, { phoneNumber: '0511111111' }, { role: 'user', phoneNumber: '+966511111111' });
  assert.deepEqual(saved.draft, { role: 'moderator', phoneNumber: '+966511111111' });
  assert.deepEqual(saved.conflicts, []);
  const cleared = commitUserEdit(edit, { phoneNumber: '' }, { role: 'user', phoneNumber: '' });
  assert.deepEqual(cleared.draft, { role: 'moderator', phoneNumber: '' });
  assert.equal(userEditIsDirty(cleared), true);
});

test('an untouched user adopts cleared contact data and matching saved edits become clean', () => {
  const original = createUserDraft({ role: 'unknown', phoneNumber: '0500000000' });
  assert.equal(original.role, 'user');
  const edit = reconcileUserEdit(undefined, original);
  assert.equal(reconcileUserEdit(edit, createUserDraft({ role: 'user' })).draft.phoneNumber, '');
  edit.draft = { role: 'moderator', phoneNumber: '' };
  const saved = commitUserEdit(edit, edit.draft, { ...edit.draft });
  assert.equal(userEditIsDirty(saved), false);
  assert.deepEqual(saved.conflicts, []);
});
