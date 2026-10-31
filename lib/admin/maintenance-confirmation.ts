/** Normalize pasted typography only; the complete confirmation wording remains required. */
export function normalizeMaintenanceConfirmation(value: string) {
  return value.normalize('NFKC')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim();
}
