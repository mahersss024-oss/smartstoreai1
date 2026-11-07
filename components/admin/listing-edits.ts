export type ListingDraft = {
  carModel: string;
  categoryOption: string;
  title: string;
  description: string;
  category: string;
  city: string;
  condition: 'new' | 'used' | 'like_new' | 'damaged' | '';
  price: string;
  priceMode: 'fixed' | 'bid' | 'negotiable';
  status: 'draft' | 'pending' | 'published' | 'paused' | 'sold' | 'rejected' | 'deleted';
};

export type ListingEdit = {
  base: ListingDraft;
  draft: ListingDraft;
  conflicts: Array<keyof ListingDraft>;
};

const fields = Object.keys({
  carModel: '', categoryOption: '', title: '', description: '', category: '',
  city: '', condition: '', price: '', priceMode: '', status: '',
}) as Array<keyof ListingDraft>;

/** Rebase untouched fields while keeping genuine local edits for review. */
export function reconcileListingEdit(current: ListingEdit | undefined, incoming: ListingDraft): ListingEdit {
  if (!current) return { base: incoming, draft: incoming, conflicts: [] };
  const draft = { ...incoming };
  const conflicts: Array<keyof ListingDraft> = [];
  for (const field of fields) {
    if (current.draft[field] === current.base[field]) continue;
    // Every draft field is a string; assigning via the record keeps its union type intact.
    (draft as Record<string, string>)[field] = current.draft[field];
    if (incoming[field] !== current.draft[field] &&
      (incoming[field] !== current.base[field] || current.conflicts.includes(field))) {
      conflicts.push(field);
    }
  }
  // Dependent controls represent one value. Mixing a local amount with a server
  // price mode, or a local model with a server category, would corrupt that edit.
  const groups: Array<Array<keyof ListingDraft>> = [
    ['price', 'priceMode'], ['category', 'categoryOption', 'carModel'],
  ];
  for (const group of groups) {
    if (!group.some(field => current.draft[field] !== current.base[field])) continue;
    const review = group.some(field => incoming[field] !== current.base[field] || current.conflicts.includes(field));
    for (const field of group) {
      (draft as Record<string, string>)[field] = current.draft[field];
      if (review && incoming[field] !== current.draft[field] && !conflicts.includes(field)) conflicts.push(field);
    }
  }
  return { base: incoming, draft, conflicts };
}

export function listingEditIsDirty(edit: ListingEdit | undefined) {
  return Boolean(edit && fields.some(field => edit.draft[field] !== edit.base[field]));
}

/** A partial update must never resubmit an untouched status, price or content field. */
export function listingEditPatch(edit: ListingEdit): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === 'price' || field === 'priceMode' || edit.draft[field] === edit.base[field]) continue;
    const value = edit.draft[field];
    patch[field] = ['categoryOption', 'carModel', 'city', 'condition'].includes(field) ? value || null : value;
  }
  if (edit.draft.price !== edit.base.price || edit.draft.priceMode !== edit.base.priceMode) {
    patch.price = edit.draft.priceMode === 'fixed' && edit.draft.price.trim() ? Number(edit.draft.price) : null;
    patch.priceMode = edit.draft.priceMode === 'fixed' ? null : edit.draft.priceMode;
  }
  return patch;
}
