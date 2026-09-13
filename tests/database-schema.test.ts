import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();

test('preserves admin audit logs when an admin user is deleted', () => {
  const schema = readFileSync(join(projectRoot, 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    join(
      projectRoot,
      'prisma/migrations/20260913000000_preserve_admin_audit_logs/migration.sql',
    ),
    'utf8',
  );

  assert.match(schema, /adminId\s+String\?/);
  assert.match(schema, /admin\s+User\?\s+@relation\(fields: \[adminId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(migration, /ON DELETE SET NULL/);
});
