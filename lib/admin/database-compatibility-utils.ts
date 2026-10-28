type TriggerOperation = {
  position: number;
  action: 'create' | 'drop';
  name: string;
  table: string;
};

/** Return only triggers that remain after all checked-in migrations finish. */
export function getActiveMigrationTriggers(migrations: readonly string[]) {
  const active = new Set<string>();
  const createTrigger = /(?:^|;)\s*CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-zA-Z_][\w$]*)"?[^;]*?\bON\s+(?:"?[a-zA-Z_][\w$]*"?\.)?"?([a-zA-Z_][\w$]*)"?/gim;
  const dropTrigger = /(?:^|;)\s*DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][\w$]*)"?\s+ON\s+(?:"?[a-zA-Z_][\w$]*"?\.)?"?([a-zA-Z_][\w$]*)"?/gim;

  for (const sql of migrations) {
    const operations: TriggerOperation[] = [
      ...[...sql.matchAll(createTrigger)].map((match) => ({
        position: match.index ?? 0,
        action: 'create' as const,
        name: match[1],
        table: match[2],
      })),
      ...[...sql.matchAll(dropTrigger)].map((match) => ({
        position: match.index ?? 0,
        action: 'drop' as const,
        name: match[1],
        table: match[2],
      })),
    ].sort((left, right) => left.position - right.position);

    for (const operation of operations) {
      const identity = `${operation.table}.${operation.name}`;
      if (operation.action === 'create') active.add(identity);
      else active.delete(identity);
    }
  }

  return active;
}

export function isPrismaTableType(tableType: string) {
  return tableType === 'BASE TABLE';
}
