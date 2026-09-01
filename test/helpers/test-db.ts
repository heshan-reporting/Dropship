import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/db/schema.js';

/**
 * A real Postgres for tests, run in WASM.
 *
 * The order pipeline is the code most expensive to get wrong, and mocking the
 * database would only prove the mocks agree with themselves. PGlite runs actual
 * Postgres — same types, same constraints, same foreign keys — with no server to
 * install, so the schema under test is the schema that ships.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  // Apply the generated migration rather than a hand-written copy, so a schema
  // change that was never migrated fails the tests instead of passing quietly.
  const dir = join(process.cwd(), 'drizzle');
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()[0];
  const sql = readFileSync(join(dir, file), 'utf8');

  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await client.exec(trimmed);
  }

  return { db, client };
}
