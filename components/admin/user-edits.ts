export type UserDraft = {
  role: 'user' | 'moderator' | 'admin';
  phoneNumber: string;
};

export type UserEdit = {
  base: UserDraft;
  draft: UserDraft;
  conflicts: Array<keyof UserDraft>;
};

const fields = ['role', 'phoneNumber'] as const;

export function createUserDraft(user: { role: string; phoneNumber?: string | null }): UserDraft {
  return {
    role: user.role === 'admin' || user.role === 'moderator' ? user.role : 'user',
    phoneNumber: user.phoneNumber ?? '',
  };
}

/** Preserve local edits while adopting server changes to untouched fields. */
export function reconcileUserEdit(current: UserEdit | undefined, incoming: UserDraft): UserEdit {
  if (!current) return { base: incoming, draft: incoming, conflicts: [] };
  const draft = { ...incoming };
  const conflicts: Array<keyof UserDraft> = [];
  for (const field of fields) {
    if (current.draft[field] === current.base[field]) continue;
    (draft as Record<string, string>)[field] = current.draft[field];
    if (incoming[field] !== current.draft[field] &&
        (incoming[field] !== current.base[field] || current.conflicts.includes(field))) conflicts.push(field);
  }
  return { base: incoming, draft, conflicts };
}

/** A one-field action must not discard another field's unsaved changes. */
export function commitUserEdit(current: UserEdit | undefined, submitted: Partial<UserDraft>, incoming: UserDraft): UserEdit {
  const next = reconcileUserEdit(current, incoming);
  for (const field of fields) {
    if (submitted[field] === undefined) continue;
    (next.draft as Record<string, string>)[field] = incoming[field];
    next.conflicts = next.conflicts.filter(conflict => conflict !== field);
  }
  return next;
}

export function userEditIsDirty(edit: UserEdit | undefined) {
  return Boolean(edit && fields.some(field => edit.draft[field] !== edit.base[field]));
}
