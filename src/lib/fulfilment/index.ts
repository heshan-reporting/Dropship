import { PrintifyFulfilment } from './printify.js';
import { ManualFulfilment } from './manual.js';
import type { FulfilmentProvider } from './types.js';

export * from './types.js';
export { PrintifyFulfilment } from './printify.js';
export { ManualFulfilment } from './manual.js';

const providers: FulfilmentProvider[] = [new PrintifyFulfilment(), new ManualFulfilment()];

/** Look up a provider by id, falling back to manual so an order is never lost. */
export function getProvider(id: string): FulfilmentProvider {
  const found = providers.find((p) => p.id === id);
  if (!found) return providers.find((p) => p.id === 'manual')!;
  // A provider missing its credentials must not silently drop the order.
  return found.isConfigured() ? found : providers.find((p) => p.id === 'manual')!;
}

export function listProviders(): FulfilmentProvider[] {
  return providers;
}
