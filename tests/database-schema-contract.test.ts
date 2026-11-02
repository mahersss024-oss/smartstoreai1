import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDatabaseSchema, type CatalogColumn, type CatalogIndex, type CatalogForeignKey, type CatalogEnum } from '@/lib/admin/database-schema-contract';

type Model = Parameters<typeof compareDatabaseSchema>[0][number];
type Field = Model['fields'][number];
const field = (name: string, type: string, overrides: Partial<Field> = {}): Field => ({ name, type, kind: 'scalar', isList: false, isRequired: true, isId: false, isUnique: false, ...overrides });
const models: Model[] = [
  { name: 'Seller', fields: [field('id', 'String', { isId: true }), field('email', 'String', { isUnique: true }), field('phone', 'String', { isRequired: false })], uniqueFields: [] },
  { name: 'Offer', fields: [field('id', 'String', { isId: true }), field('sellerId', 'String'), field('amount', 'Decimal', { isRequired: false }), field('createdAt', 'DateTime'), field('status', 'Status', { kind: 'enum' }), field('seller', 'Seller', { kind: 'object', relationFromFields: ['sellerId'], relationToFields: ['id'], relationOnDelete: 'Restrict' })], uniqueFields: [] },
];
const enums = [{ name: 'Status', values: [{ name: 'published' }, { name: 'paused' }] }];
const schema = `model Seller {
 id String @id
 email String @unique
 phone String? @db.VarChar(32)
}
model Offer {
 id String @id
 sellerId String
 amount Decimal? @db.Decimal(12, 2)
 createdAt DateTime
 status Status
}`;
function fixture() {
  const column = (table_name: string, column_name: string, udt_name: string, overrides: Partial<CatalogColumn> = {}): CatalogColumn => ({ table_name, column_name, udt_name, is_nullable: 'NO', character_maximum_length: null, numeric_precision: null, numeric_scale: null, datetime_precision: null, ...overrides });
  return {
    columns: [column('Seller', 'id', 'text'), column('Seller', 'email', 'text'), column('Seller', 'phone', 'varchar', { is_nullable: 'YES', character_maximum_length: 32 }), column('Offer', 'id', 'text'), column('Offer', 'sellerId', 'text'), column('Offer', 'amount', 'numeric', { is_nullable: 'YES', numeric_precision: 12, numeric_scale: 2 }), column('Offer', 'createdAt', 'timestamp', { datetime_precision: 3 }), column('Offer', 'status', 'Status')],
    indexes: [{ table_name: 'Seller', columns: ['id'], is_primary: true, is_unique: true, is_valid: true, is_partial: false }, { table_name: 'Seller', columns: ['email'], is_primary: false, is_unique: true, is_valid: true, is_partial: false }, { table_name: 'Offer', columns: ['id'], is_primary: true, is_unique: true, is_valid: true, is_partial: false }] as CatalogIndex[],
    foreignKeys: [{ table_name: 'Offer', columns: ['sellerId'], referenced_table: 'Seller', referenced_columns: ['id'], delete_action: 'r', update_action: 'c', validated: true }] as CatalogForeignKey[],
    enums: [{ name: 'Status', values: ['published', 'paused'] }] as CatalogEnum[],
  };
}
const compare = (catalog = fixture()) => compareDatabaseSchema(models, enums, schema, catalog);

test('a compatible PostgreSQL catalog includes native types, unique keys and relation actions', () => {
  for (const differences of Object.values(compare())) assert.deepEqual(differences, []);
});

test('same column names cannot hide a wrong type, length, decimal precision or timestamp precision', () => {
  for (const change of [
    (catalog: ReturnType<typeof fixture>) => { catalog.columns[1].udt_name = 'int4'; },
    (catalog: ReturnType<typeof fixture>) => { catalog.columns[2].character_maximum_length = 31; },
    (catalog: ReturnType<typeof fixture>) => { catalog.columns[5].numeric_scale = 3; },
    (catalog: ReturnType<typeof fixture>) => { catalog.columns[6].datetime_precision = 6; },
  ]) {
    const catalog = fixture(); change(catalog);
    assert.equal(compare(catalog).mismatchedColumns.length, 1);
  }
  const catalog = fixture(); catalog.columns[1].is_nullable = 'YES';
  assert.deepEqual(compare(catalog).mismatchedNullability, ['Seller.email']);
});

test('partial or invalid uniqueness and wrong or unvalidated foreign keys are not accepted', () => {
  for (const flag of ['is_valid', 'is_partial'] as const) {
    const catalog = fixture(); catalog.indexes[1][flag] = flag === 'is_partial';
    assert.deepEqual(compare(catalog).missingKeys, ['Seller(email): unique']);
  }
  for (const change of [
    (key: CatalogForeignKey) => { key.validated = false; },
    (key: CatalogForeignKey) => { key.delete_action = 'c'; },
    (key: CatalogForeignKey) => { key.update_action = 'a'; },
    (key: CatalogForeignKey) => { key.referenced_columns = ['email']; },
  ]) {
    const catalog = fixture(); change(catalog.foreignKeys[0]);
    assert.equal(compare(catalog).mismatchedRelations.length, 1);
  }
});

test('missing or extra enum values are detected without imposing declaration ordering', () => {
  const catalog = fixture(); catalog.enums[0].values.reverse();
  assert.deepEqual(compare(catalog).mismatchedEnums, []);
  catalog.enums[0].values.push('unexpected');
  assert.deepEqual(compare(catalog).mismatchedEnums, ['Status']);
});
