type Field = {
  name: string; dbName?: string | null; kind: string; type: string;
  isList: boolean; isRequired: boolean; isId: boolean; isUnique: boolean;
  relationFromFields?: readonly string[]; relationToFields?: readonly string[]; relationOnDelete?: string;
};
type Model = {
  name: string; dbName?: string | null; fields: readonly Field[];
  primaryKey?: { fields: readonly string[] } | null; uniqueFields: readonly (readonly string[])[];
};
type Enum = { name: string; dbName?: string | null; values: readonly { name: string; dbName?: string | null }[] };
export type CatalogColumn = {
  table_name: string; column_name: string; udt_name: string; is_nullable: string;
  character_maximum_length: number | null; numeric_precision: number | null;
  numeric_scale: number | null; datetime_precision: number | null;
};
export type CatalogIndex = { table_name: string; columns: string[]; is_primary: boolean; is_unique: boolean; is_valid: boolean; is_partial: boolean };
export type CatalogForeignKey = { table_name: string; columns: string[]; referenced_table: string; referenced_columns: string[]; delete_action: string; update_action: string; validated: boolean };
export type CatalogEnum = { name: string; values: string[] };
const table = (model: Model) => model.dbName ?? model.name;
const column = (field: Field) => field.dbName ?? field.name;

/** Native column declarations are not retained in Prisma's runtime DMMF. */
function nativeTypes(schema: string) {
  const result = new Map<string, { name: string; arguments: number[] }>();
  for (const model of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const line of model[2].split(/\r?\n/)) {
      const field = line.match(/^\s*(\w+)\s+\w+(?:\?|\[\])?\s+.*?@db\.(\w+)(?:\(([^)]*)\))?/);
      if (field) result.set(`${model[1]}.${field[1]}`, { name: field[2], arguments: field[3]?.split(',').map(value => Number(value.trim())) ?? [] });
    }
  }
  return result;
}

export function compareDatabaseSchema(models: readonly Model[], enums: readonly Enum[], schema: string, catalog: {
  columns: CatalogColumn[]; indexes: CatalogIndex[]; foreignKeys: CatalogForeignKey[]; enums: CatalogEnum[];
}) {
  const declarations = nativeTypes(schema);
  const mismatchedColumns: string[] = [];
  const mismatchedNullability: string[] = [];
  const missingKeys: string[] = [];
  const mismatchedRelations: string[] = [];
  const mismatchedEnums: string[] = [];
  const unsupportedTypes: string[] = [];
  const defaultTypes: Record<string, string> = { String: 'text', Int: 'int4', BigInt: 'int8', Float: 'float8', Decimal: 'numeric', Boolean: 'bool', DateTime: 'timestamp', Json: 'jsonb', Bytes: 'bytea' };
  const postgresTypes: Record<string, string> = { Text: 'text', VarChar: 'varchar', Char: 'bpchar', Uuid: 'uuid', SmallInt: 'int2', Integer: 'int4', BigInt: 'int8', Real: 'float4', DoublePrecision: 'float8', Decimal: 'numeric', Money: 'money', Boolean: 'bool', Timestamp: 'timestamp', Timestamptz: 'timestamptz', Date: 'date', Time: 'time', Timetz: 'timetz', Json: 'json', JsonB: 'jsonb', ByteA: 'bytea', Inet: 'inet', Bit: 'bit', VarBit: 'varbit', Oid: 'oid' };
  const sameColumns = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value, index) => value === right[index]);
  for (const model of models) {
    const name = table(model);
    const fieldNames = (names: readonly string[]) => names.map(name => column(model.fields.find(field => field.name === name)!));
    for (const field of model.fields.filter(field => field.kind === 'scalar' || field.kind === 'enum')) {
      const identity = `${name}.${column(field)}`;
      const actual = catalog.columns.find(value => value.table_name === name && value.column_name === column(field));
      if (!actual) continue; // The existing presence inventory reports this.
      const native = declarations.get(`${model.name}.${field.name}`);
      const enumName = enums.find(value => value.name === field.type);
      const type = field.kind === 'enum' ? enumName?.dbName ?? field.type : native ? postgresTypes[native.name] : defaultTypes[field.type];
      if (!type) { unsupportedTypes.push(identity); continue; }
      const expected = `${field.isList ? '_' : ''}${type}`;
      let mismatch = actual.udt_name !== expected;
      if (!field.isList && native?.name === 'Decimal') mismatch ||= actual.numeric_precision !== (native.arguments[0] ?? 65) || actual.numeric_scale !== (native.arguments[1] ?? 30);
      if (!field.isList && ['VarChar', 'Char', 'Bit', 'VarBit'].includes(native?.name ?? '') && native?.arguments.length) mismatch ||= actual.character_maximum_length !== native.arguments[0];
      if (!field.isList && field.type === 'DateTime' && ['timestamp', 'timestamptz', 'time', 'timetz'].includes(type)) mismatch ||= actual.datetime_precision !== (native?.arguments[0] ?? 3);
      if (mismatch) mismatchedColumns.push(`${identity}: expected ${expected}${native?.arguments.length ? `(${native.arguments.join(',')})` : ''}; found ${actual.udt_name}`);
      // PostgreSQL scalar-list columns generated by Prisma may be nullable even
      // though DMMF describes the list as required; it does not declare NOT NULL.
      if (!field.isList && actual.is_nullable !== (field.isRequired ? 'NO' : 'YES')) mismatchedNullability.push(identity);
    }
    const primary = model.primaryKey?.fields ?? model.fields.filter(field => field.isId).map(field => field.name);
    const keys = [{ fields: primary, primary: true }, ...model.uniqueFields.map(fields => ({ fields, primary: false })),
      ...model.fields.filter(field => field.isUnique).map(field => ({ fields: [field.name], primary: false }))];
    for (const key of keys.filter(key => key.fields.length)) {
      const columns = fieldNames(key.fields);
      if (!catalog.indexes.some(index => index.table_name === name && index.is_valid && !index.is_partial &&
        (key.primary ? index.is_primary : index.is_unique) && sameColumns(index.columns, columns))) missingKeys.push(`${name}(${columns.join(',')}): ${key.primary ? 'primary' : 'unique'}`);
    }
    for (const relation of model.fields.filter(field => field.kind === 'object' && field.relationFromFields?.length)) {
      const target = models.find(value => value.name === relation.type);
      if (!target) continue;
      const columns = fieldNames(relation.relationFromFields!);
      const referenced = (relation.relationToFields ?? []).map(name => column(target.fields.find(field => field.name === name)!));
      const deletion = relation.relationOnDelete ?? (relation.isRequired ? 'Restrict' : 'SetNull');
      const action: Record<string, string> = { Cascade: 'c', Restrict: 'r', SetNull: 'n', NoAction: 'a', SetDefault: 'd' };
      if (!catalog.foreignKeys.some(key => key.table_name === name && key.referenced_table === table(target) && key.validated &&
        sameColumns(key.columns, columns) && sameColumns(key.referenced_columns, referenced) && key.delete_action === action[deletion] && key.update_action === 'c')) {
        mismatchedRelations.push(`${name}(${columns.join(',')}) -> ${table(target)}(${referenced.join(',')})`);
      }
    }
  }
  for (const expected of enums) {
    const name = expected.dbName ?? expected.name;
    const actual = catalog.enums.find(value => value.name === name);
    const values = expected.values.map(value => value.dbName ?? value.name);
    if (!actual || actual.values.length !== values.length || values.some(value => !actual.values.includes(value))) mismatchedEnums.push(name);
  }
  return { mismatchedColumns, mismatchedNullability, missingKeys, mismatchedRelations, mismatchedEnums, unsupportedTypes };
}
