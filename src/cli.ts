/**
 * Minimal CLI so the engine can be exercised without a frontend.
 *
 *   npm run search -- "collapsible dog bowl"
 *   npm run search -- "phone stand" --limit 10 --marketplace cj
 */

import { createEngine, formatMoney, rankProducts, type Marketplace } from './index.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const term = argv.filter((a) => !a.startsWith('--')).join(' ');

  if (!term) {
    console.error('usage: npm run search -- "<product idea>" [--limit N] [--marketplace X] [--verbose]');
    process.exit(1);
  }

  const limit = Number.parseInt(flag(argv, '--limit') ?? '15', 10);
  const marketplace = flag(argv, '--marketplace') as Marketplace | undefined;
  const verbose = argv.includes('--verbose');

  const engine = createEngine();
  const status = engine.status();
  const configured = status.filter((s) => s.configured);

  if (configured.length === 0) {
    console.error('No sources configured. Copy .env.example to .env and add at least one credential.\n');
    for (const s of status) console.error(`  ✗ ${s.label} (${s.kind})`);
    process.exit(1);
  }

  console.log(`Searching "${term}" across ${configured.length} source(s)...\n`);

  const result = await engine.search(
    { term, limit, marketplaces: marketplace ? [marketplace] : undefined },
    { log: verbose ? (msg) => console.error(`  · ${msg}`) : undefined },
  );

  const ranked = rankProducts(result.products);

  for (const [i, p] of ranked.entries()) {
    const price = formatMoney(p.price) + (p.priceMax ? `–${formatMoney(p.priceMax)}` : '');
    console.log(`${String(i + 1).padStart(2)}. [${String(p.score.total).padStart(3)}] ${p.title.slice(0, 68)}`);
    console.log(`     ${price}  ·  ${p.marketplace}  ·  ${p.url}`);
    if (verbose) {
      for (const f of p.score.factors) {
        console.log(`       ${f.name.padEnd(9)} ${(f.value * 100).toFixed(0).padStart(3)}%  ${f.note}`);
      }
      if (p.score.unknowns.length) console.log(`       unknown: ${p.score.unknowns.join(', ')}`);
    }
  }

  console.log(`\n${ranked.length} products in ${result.elapsedMs}ms`);
  if (result.sourcesQueried.length) console.log(`queried:  ${result.sourcesQueried.join(', ')}`);
  if (result.sourcesSkipped.length) console.log(`skipped:  ${result.sourcesSkipped.join(', ')} (not configured)`);
  for (const e of result.errors) {
    console.log(`error:    ${e.source} — ${e.message}${e.recovered ? ' (fell back)' : ''}`);
  }
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
