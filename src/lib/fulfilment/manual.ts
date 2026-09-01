import type {
  FulfilmentProvider,
  FulfilmentRequest,
  FulfilmentResult,
  FulfilmentStatus,
} from './types.js';

/**
 * Manual fulfilment: the order is recorded and waits for a human to place it
 * with the supplier, then paste the tracking number back.
 *
 * This is not a stub. Anything sourced outside Printify genuinely has to be
 * bought by hand, and pretending otherwise would mean silently accepting orders
 * the system cannot ship.
 */
export class ManualFulfilment implements FulfilmentProvider {
  readonly id = 'manual';
  readonly label = 'Manual';
  readonly automatic = false;

  isConfigured(): boolean {
    return true;
  }

  async submit(_request: FulfilmentRequest): Promise<FulfilmentResult> {
    return {
      status: 'queued',
      message: 'Waiting to be placed with the supplier by hand',
    };
  }

  async check(_externalId: string): Promise<FulfilmentStatus> {
    // Only a human can advance a manual fulfilment, via the admin queue.
    return { status: 'queued' };
  }
}
