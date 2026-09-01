/** Shared fetch wrapper: abort propagation, bounded retry, useful errors. */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface RequestOptions extends RequestInit {
  /** Retries on 429/5xx and network faults. Default 2. */
  retries?: number;
  /** Base backoff; doubles each attempt. Default 500ms. */
  backoffMs?: number;
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { retries = 2, backoffMs = 500, ...init } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (init.signal?.aborted) throw new Error('Request aborted');

    try {
      const response = await fetch(url, init);

      if (response.ok) return response;

      // 4xx other than rate-limiting will not improve on retry.
      if (response.status !== 429 && response.status < 500) {
        throw new HttpError(
          `${response.status} ${response.statusText} for ${redact(url)}`,
          response.status,
          await safeText(response),
        );
      }
      lastError = new HttpError(
        `${response.status} ${response.statusText} for ${redact(url)}`,
        response.status,
        await safeText(response),
      );
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      if (init.signal?.aborted) throw err;
      lastError = err;
    }

    if (attempt < retries) {
      await delay(backoffMs * 2 ** attempt, init.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  return (await response.json()) as T;
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Request aborted'));
      },
      { once: true },
    );
  });
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return undefined;
  }
}

/** Keep signatures and tokens out of logs and error messages. */
function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ['sign', 'access_token', 'app_key', 'apiKey', 'token']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '***');
    }
    return u.toString();
  } catch {
    return url;
  }
}
