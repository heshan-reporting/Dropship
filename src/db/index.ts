import { drizzle } from 'drizzle-orm/postgres-js';
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
 * The instance is cached on globalThis so hot reload does not leak a new pool on
 * every edit, and the pool is kept small because serverless functions each hold
 * their own.
 */

type Database = ReturnType<typeof create>;

declare global {
  // eslint-disable-next-line no-var
  var __muttwardDb: Database | undefined;
}

function create(): ReturnType<typeof drizzle<typeof schema>> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and add your Postgres URL.');
  }
  const client = postgres(url, { max: 5, idle_timeout: 20, prepare: false });
  return drizzle(client, { schema });
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
  apply(_target, thisArg, args) {
    return Reflect.apply(instance() as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
});

export * from './schema.js';
