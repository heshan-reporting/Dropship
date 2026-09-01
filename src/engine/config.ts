/**
 * Credentials, read once from the environment.
 *
 * Every field is optional by design: an unconfigured adapter reports
 * `isConfigured() === false` and the orchestrator skips it, so the engine runs
 * with whatever subset of sources you have signed up for.
 */

export interface EngineConfig {
  cj: { email?: string; apiKey?: string };
  aliexpress: { appKey?: string; appSecret?: string; trackingId?: string };
  printify: { token?: string };
  brightData: { apiKey?: string; unlockerZone?: string };
}

function env(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

export function loadConfig(): EngineConfig {
  return {
    cj: {
      email: env('CJ_EMAIL'),
      apiKey: env('CJ_API_KEY'),
    },
    aliexpress: {
      appKey: env('ALIEXPRESS_APP_KEY'),
      appSecret: env('ALIEXPRESS_APP_SECRET'),
      trackingId: env('ALIEXPRESS_TRACKING_ID'),
    },
    printify: {
      token: env('PRINTIFY_API_TOKEN'),
    },
    brightData: {
      apiKey: env('BRIGHTDATA_API_KEY'),
      unlockerZone: env('BRIGHTDATA_UNLOCKER_ZONE') ?? 'web_unlocker1',
    },
  };
}
