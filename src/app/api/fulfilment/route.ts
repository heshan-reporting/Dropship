import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, fulfilments, orders } from '@/db';
import { isAuthenticated } from '@/lib/auth';
import { getProvider } from '@/lib/fulfilment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Advance a fulfilment.
 *
 * `sync` asks an automatic provider where the order actually is; `update`
 * records what a human did for a manual one. Both converge on the same row, so
 * the orders view does not care which kind it is looking at.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: 'sync' | 'update' | 'retry';
    fulfilmentId?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    status?: string;
  } | null;

  if (!body?.fulfilmentId) {
    return NextResponse.json({ error: 'fulfilmentId is required' }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(fulfilments)
    .where(eq(fulfilments.id, body.fulfilmentId))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.action === 'sync') {
    if (!row.externalId) {
      return NextResponse.json({ error: 'Nothing to sync — no provider order' }, { status: 400 });
    }
    try {
      const status = await getProvider(row.provider).check(row.externalId);
      await db
        .update(fulfilments)
        .set({
          status: status.status,
          trackingNumber: status.trackingNumber ?? row.trackingNumber,
          trackingUrl: status.trackingUrl ?? row.trackingUrl,
          updatedAt: new Date(),
        })
        .where(eq(fulfilments.id, row.id));

      if (status.status === 'shipped') {
        await db.update(orders).set({ status: 'shipped' }).where(eq(orders.id, row.orderId));
      }
      return NextResponse.json({ ok: true, status: status.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      await db
        .update(fulfilments)
        .set({ lastError: message, updatedAt: new Date() })
        .where(eq(fulfilments.id, row.id));
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // Manual update: a human placed the order and is recording the outcome.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.trackingNumber === 'string') {
    patch.trackingNumber = body.trackingNumber.trim() || null;
  }
  if (typeof body.trackingUrl === 'string') patch.trackingUrl = body.trackingUrl.trim() || null;
  if (body.status && ['queued', 'submitted', 'shipped', 'failed', 'cancelled'].includes(body.status)) {
    patch.status = body.status;
    // Clear a stale error once someone has moved the row forward by hand.
    if (body.status !== 'failed') patch.lastError = null;
  }

  await db.update(fulfilments).set(patch).where(eq(fulfilments.id, row.id));

  if (patch.status === 'shipped') {
    await db.update(orders).set({ status: 'shipped' }).where(eq(orders.id, row.orderId));
  }

  return NextResponse.json({ ok: true });
}
