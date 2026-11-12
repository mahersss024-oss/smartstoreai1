import assert from 'node:assert/strict';

export const activeStaffAccount = { role: 'admin', deletedAt: null, sessionVersion: 0 };

/** Model the actor row separately from the mutation's target row. */
export function staffAccountQuery(actorId: string) {
  return async (sql: TemplateStringsArray, id: string) => {
    assert.match(sql.join('?'), /SELECT role, "deletedAt", "sessionVersion" FROM "User" WHERE id = \? FOR SHARE NOWAIT/);
    assert.equal(id, actorId);
    return [{ ...activeStaffAccount }];
  };
}
