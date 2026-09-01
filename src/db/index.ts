import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * Database handle.
 *
 * Connecting is deferred until the first query. Importing a module must never
 * open a socket or demand credentials: Next.js loads every route module at build
 * time to collect page data, and an eager client turns a missing DATABASE_URL
 * into a failed build rather than a clear error at the point of use.
 *
 * With no DATABASE_URL in development, this falls back to PGlite — real Postgres
 * compiled to WASM, stored under .pglite — so the app runs with nothing to
 * install. Production always requires a real DATABASE_URL; silently running a
 * store on an embedded database would be far worse than refusing to start.
 */

type Database = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __muttwardDb: Database | undefined;
}

function create(): Database {
  const url = process.env.DATABASE_URL;

  if (url) {
    // Small pool: serverless functions each hold their own.
    const client = postgres(url, { max: 5, idle_timeout: 20, prepare: false });
    return drizzle(client, { schema });
  }

  // Running a production build locally is a legitimate thing to want, so there
  // is an escape hatch — but it has to be asked for by name. Falling back
  // silently in production would mean a deployed store quietly serving from an
  // ephemeral database, losing every order on the next cold start.
  if (process.env.NODE_ENV === 'production' && process.env.USE_EMBEDDED_DB !== 'true') {
    throw new Error(
      'DATABASE_URL is not set. A production store needs a real Postgres URL. ' +
        'To run a production build locally instead, set USE_EMBEDDED_DB=true.',
    );
  }

  return createLocalDatabase();
}

/**
 * Development fallback: embedded Postgres, migrated on first use.
 *
 * PGlite is required at runtime rather than imported, so a production build
 * never needs the package present — this branch cannot be reached there.
 */
function createLocalDatabase(): Database {
  const require = createRequire(import.meta.url);
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');

  const dataDir = join(process.cwd(), '.pglite');
  const client = new PGlite(dataDir);

  console.warn(
    '\n  ⚠  No DATABASE_URL — using embedded Postgres at .pglite\n' +
      '     Fine for local development. Set DATABASE_URL before deploying.\n',
  );

  // Applying migrations is async, but the drizzle client must be built
  // synchronously. Gate the driver's own methods on that promise instead, so
  // the first query waits for the schema rather than racing it.
  const ready = applyMigrations(client);

  const guarded = new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property === 'query' || property === 'exec') && typeof value === 'function') {
        return async (...args: unknown[]) => {
          await ready;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return drizzlePglite(guarded, { schema }) as unknown as Database;
}

async function applyMigrations(client: {
  exec: (sql: string) => Promise<unknown>;
}): Promise<void> {
  const dir = join(process.cwd(), 'drizzle');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      try {
        await client.exec(trimmed);
      } catch (err) {
        // Re-running a migration on an existing store is expected; anything
        // else is worth surfacing.
        const message = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(message)) console.error('Migration failed:', message);
      }
    }
  }
}

function instance(): Database {
  if (!globalThis.__muttwardDb) globalThis.__muttwardDb = create();
  return globalThis.__muttwardDb;
}

/**
 * Proxy so callers keep writing `db.select()` while construction stays lazy.
 * Every trap forwards to the real client, created on first touch.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(instance() as object, property, receiver);
  },
  has(_target, property) {
    return Reflect.has(instance() as object, property);
  },
});

export * from './schema.js';
