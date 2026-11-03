/**
 * Retired owner maintenance capability. Keep explicit rejection at the old
 * programmatic entry points so stale scripts cannot re-enable a market wipe.
 * This module intentionally imports no database, storage, signing or worker code.
 */
export const marketResetConfirmation = 'حذف بيانات السوق والإبقاء على المستخدمين';

export class MarketResetError extends Error {
  constructor(public code: string, public status = 403) { super(code); }
}

export type MarketResetClaim = { actorId: string; asOf: number; fingerprint: string };
type MarketResetInput = {
  actorId: string; reason: string; previewToken: string; confirmation: string;
  backupConfirmed: boolean; includeProtectedData: boolean;
};

function readOnly(): never { throw new MarketResetError('maintenance_read_only', 403); }

export function signMarketResetPreview(claim: MarketResetClaim): never {
  void claim;
  return readOnly();
}

export function verifyMarketResetPreview(token: string, actorId: string, now = Date.now()): never {
  void [token, actorId, now];
  return readOnly();
}

export async function getMarketResetPreview(actorId: string): Promise<never> {
  void actorId;
  return readOnly();
}

export async function executeMarketReset(input: MarketResetInput): Promise<never> {
  void input;
  return readOnly();
}
