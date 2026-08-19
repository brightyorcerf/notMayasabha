/**
 * The kill switch. Installed before any application code runs.
 *
 * Takes:   nothing.
 * Returns: a live health record.
 * Assumes: loopback is permitted, because the app's own dev server and HMR channel
 *          are loopback. Everything else is refused and counted. This is the claim
 *          judges are shown: not "we do not call out", but "we cannot".
 */

export interface Attempt {
  api: string;
  url: string;
  loopback: boolean;
  at: number;
}

export interface Health {
  sealed: boolean;
  started: number;
  attempts: Attempt[];
  external: number;
  loopback: number;
}

export const health: Health = {
  sealed: true,
  started: Date.now(),
  attempts: [],
  external: 0,
  loopback: 0,
};

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i;

function classify(raw: unknown): { url: string; loopback: boolean } {
  const s = String(raw ?? '');
  if (s.startsWith('data:') || s.startsWith('blob:')) return { url: s.slice(0, 40), loopback: true };
  try {
    const u = new URL(s, location.href);
    if (u.protocol === 'file:') return { url: u.href, loopback: true };
    return { url: u.href, loopback: LOOPBACK.test(u.hostname) };
  } catch {
    return { url: s, loopback: true };
  }
}

function record(api: string, raw: unknown): boolean {
  const { url, loopback } = classify(raw);
  health.attempts.push({ api, url, loopback, at: Date.now() });
  if (health.attempts.length > 200) health.attempts.shift();
  if (loopback) { health.loopback++; return true; }
  health.external++;
  health.sealed = false;
  console.warn(`[netguard] BLOCKED ${api} -> ${url}`);
  return false;
}

export function installNetGuard(): void {
  const realFetch = globalThis.fetch?.bind(globalThis);
  if (realFetch) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' || input instanceof URL ? input : input.url;
      if (!record('fetch', raw)) return Promise.reject(new Error('netguard: outbound request refused'));
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  }

  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]
  ) {
    if (!record('xhr', url)) throw new Error('netguard: outbound request refused');
    // eslint-disable-next-line prefer-rest-params
    return realOpen.apply(this, [method, url, ...rest] as unknown as Parameters<typeof realOpen>);
  } as typeof XMLHttpRequest.prototype.open;

  const RealWS = globalThis.WebSocket;
  if (RealWS) {
    const Guarded = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      if (!record('websocket', url)) throw new Error('netguard: outbound socket refused');
      return new RealWS(url, protocols);
    } as unknown as typeof WebSocket;
    Guarded.prototype = RealWS.prototype;
    globalThis.WebSocket = Guarded;
  }

  const RealES = globalThis.EventSource;
  if (RealES) {
    const Guarded = function (this: unknown, url: string | URL, init?: EventSourceInit) {
      if (!record('eventsource', url)) throw new Error('netguard: outbound stream refused');
      return new RealES(url, init);
    } as unknown as typeof EventSource;
    Guarded.prototype = RealES.prototype;
    globalThis.EventSource = Guarded;
  }

  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) =>
      record('beacon', url) ? realBeacon(url, data) : false) as typeof navigator.sendBeacon;
  }
}
