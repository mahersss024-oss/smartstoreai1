# Account Deletion And Re-registration

- Google browser/native sign-in and Apple sign-in share `lib/auth/registration.ts`.
- Self-deletion records `self_user_delete` in the existing `AdminAuditLog`, in the same transaction as deletion. The actor is recorded in metadata, not impersonated as an administrator.
- A self-deleted customer can register again with the verified email. Registration creates a fresh user ID and does not restore the deleted account's permissions, listings, conversations, or cookies.
- When evidence requires retaining the old user, its deletion flag and related records remain intact. Its unique email is replaced with a reserved invalid address when the new account is created. The original identity remains available in the existing audit record.
- Administrative deletions take precedence, including permanent deletions and sign-in through another provider using the same verified email. Only a later explicit administrative reactivation cancels that decision; a role update or self-deletion does not.
- Unknown legacy soft-deletion causes are denied rather than guessed. Those accounts require an administrator to verify the history and explicitly reactivate them. No production backfill is performed.
- Registration runs in a serializable transaction with at most three attempts for serialization/uniqueness races. Deletion locks the user before recording the cause.
- No database tables, columns, migrations, routes, or identity-provider verification rules are added or changed.

## Verification

Focused unit tests cover both registration entry points, self/admin deletion precedence, unknown legacy records, preserved profile/agreements, and bounded retries. PostgreSQL integration tests exercise actual self-deletion, fresh registration, concurrent cross-provider registration, old-session rejection, retained evidence, explicit administrative reactivation, and blocking after permanent administrative deletion.

The database checks use an isolated loopback PostgreSQL instance. They do not exercise production RDS or live Google/Apple sign-in.
