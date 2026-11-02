type TriggerOperation = {
  position: number;
  action: 'create' | 'drop';
  name: string;
  table: string;
};

/**
 * Expand the literal FOREACH/format declarations used by committed migrations.
 * This does not execute SQL or treat arbitrary dynamic SQL as a known contract.
 */
function literalLoopTriggerOperations(sql: string): TriggerOperation[] {
  const loops = /\bFOREACH\s+([a-zA-Z_][\w$]*)\s+IN\s+ARRAY\s+ARRAY\s*\[([^\]]*)\]\s+LOOP\b([\s\S]*?)\bEND\s+LOOP\s*;/gi;
  const operations: TriggerOperation[] = [];
  for (const loop of sql.matchAll(loops)) {
    const variable = loop[1];
    const literals = [...loop[2].matchAll(/'((?:[^']|'')*)'/g)];
    // Reject expressions rather than silently inventing the resulting names.
    if (loop[2].replace(/'((?:[^']|'')*)'/g, '').replace(/[\s,]/g, '')) continue;
    const commands = /\bEXECUTE\s+format\s*\(\s*'((?:[^']|'')*)'\s*,\s*([a-zA-Z_][\w$]*)\s*\)\s*;/gi;
    for (const command of loop[3].matchAll(commands)) {
      if (command[2].toLowerCase() !== variable.toLowerCase()) continue;
      const statement = command[1].replace(/''/g, "'");
      // Only a single identifier argument and a table identifier placeholder
      // are supported. Literal CREATE/DROP statements retain ordinary parsing.
      const match = statement.match(/^\s*(CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-zA-Z_][\w$]*)"?[^;]*?\bON\s+%I\b|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][\w$]*)"?\s+ON\s+%I\b)/i);
      if (!match || (statement.match(/%(?:I|L|s)/g)?.length ?? 0) !== 1) continue;
      for (const literal of literals) {
        operations.push({ position: (loop.index ?? 0) + loop[0].indexOf(loop[3]) + (command.index ?? 0),
          action: match[2] ? 'create' : 'drop', name: match[2] ?? match[3],
          table: literal[1].replace(/''/g, "'") });
      }
    }
  }
  return operations;
}

/** Return only triggers that remain after all checked-in migrations finish. */
export function getActiveMigrationTriggers(migrations: readonly string[]) {
  const active = new Set<string>();
  const createTrigger = /(?:^|;)\s*CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-zA-Z_][\w$]*)"?[^;]*?\bON\s+(?:"?[a-zA-Z_][\w$]*"?\.)?"?([a-zA-Z_][\w$]*)"?/gim;
  const dropTrigger = /(?:^|;)\s*DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][\w$]*)"?\s+ON\s+(?:"?[a-zA-Z_][\w$]*"?\.)?"?([a-zA-Z_][\w$]*)"?/gim;

  for (const sql of migrations) {
    const operations: TriggerOperation[] = [
      ...literalLoopTriggerOperations(sql),
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
