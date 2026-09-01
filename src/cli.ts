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

  const ICON: Record<string, string> = { blocker: '\u2717', warning: '!', note: '\u00b7' };

  for (const [i, p] of ranked.entries()) {
    const e = p.score.economics;
    const capped = p.score.total < p.score.rawTotal ? ` (capped from ${p.score.rawTotal})` : '';

    console.log(`${String(i + 1).padStart(2)}. [${String(p.score.total).padStart(3)}]${capped} ${p.title.slice(0, 62)}`);
    console.log(
      `     ${formatMoney(p.price)} cost \u2192 ${formatMoney(e.suggestedRetail)} retail  ` +
        `\u00b7  ${e.viable ? '+' : ''}${formatMoney(e.contributionMargin)}/order  ` +
        `\u00b7  ${p.marketplace}`,
    );

    for (const f of p.score.flags) {
      console.log(`     ${ICON[f.severity]} ${f.message}`);
    }

    if (verbose) {
      console.log(`     ${p.url}`);
      for (const f of p.score.factors) {
        console.log(
          `       ${f.name.padEnd(11)} ${(f.value * 100).toFixed(0).padStart(3)}%  ` +
            `\u00d7${(f.weight * 100).toFixed(0).padStart(3)}%   ${f.note}`,
        );
      }
      console.log(
        `       break-even CAC ${formatMoney(e.breakEvenCac)}  \u00b7  ` +
          `confidence ${(p.score.confidence * 100).toFixed(0)}%` +
          (p.score.unknowns.length ? `  \u00b7  unknown: ${p.score.unknowns.join(', ')}` : ''),
      );
    }
    console.log();
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
