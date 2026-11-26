import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request as dial } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { ProviderHttpError } from './errors.js';

/** Addresses a typed host may never reach: unspecified, private, shared, loopback, link-local (the cloud metadata
 * address), documentation, relay, benchmarking, multicast and reserved ranges, and their IPv6 counterparts. Never add
 * `::ffff:0:0/96`: BlockList applies the IPv4 rules to IPv4-mapped addresses itself, and that IPv6 rule would match
 * every IPv4 address, refusing the whole internet. */
const BLOCKED = new BlockList();
for (const range of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3', '::/96',
  '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/32', '2001:db8::/32', '2002::/16', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8']) {
  const [network = '', prefix] = range.split('/');
  BLOCKED.addSubnet(network, Number(prefix), isIP(network) === 4 ? 'ipv4' : 'ipv6');
}

/** Whether an address is one an entry's typed host may never reach; anything that is not an IP is blocked. */
export function blockedAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 0 || BLOCKED.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const refusal = () => new ProviderHttpError('request_failed', null, 'address_blocked');

/** `dns.lookup` that answers only when every resolved address is allowed: the lookup `guardedFetch` dials with. */
export function guardedLookup(host: string, options: LookupOptions,
  callback: (error: Error | null, address?: string | LookupAddress[], family?: number) => void): void {
  lookup(host, { ...options, all: true }, (error, addresses) => {
    const first = error ? undefined : addresses[0];
    if (error) callback(error);
    else if (first === undefined || addresses.some(({ address }) => blockedAddress(address))) callback(refusal());
    else if (options.all === true) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}

/** A fetch over node:https that refuses, before any request byte is written, every blocked address it would dial. It
 * answers a redirect as `redirect: 'manual'` does, never following it, and streams the answer's body. */
export const guardedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  const url = new URL(request.url);
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'https:' || (isIP(host) !== 0 && blockedAddress(host))) throw refusal();
  const body = request.body === null ? undefined : Buffer.from(await request.arrayBuffer());
  return new Promise<Response>((resolve, reject) => {
    const outgoing = dial(url, { method: request.method, headers: Object.fromEntries(request.headers), signal: request.signal,
      lookup: guardedLookup as LookupFunction });
    // A reused socket is checked again; a new one as it connects, before TLS or the request writes anything.
    outgoing.on('socket', socket => {
      const check = () => { if (blockedAddress(socket.remoteAddress ?? '')) outgoing.destroy(refusal()); };
      if (socket.connecting) socket.prependOnceListener('connect', check); else check();
    });
    outgoing.on('error', error => {
      // As fetch does: an abort rejects with the signal's reason, a refusal as it is, anything else as `fetch failed`.
      reject(request.signal.aborted ? request.signal.reason as Error
        : error instanceof ProviderHttpError ? error : new TypeError('fetch failed', { cause: error }));
    });
    outgoing.on('response', incoming => {
      const headers = new Headers();
      for (let at = 0; at < incoming.rawHeaders.length; at += 2) headers.append(incoming.rawHeaders[at] ?? '', incoming.rawHeaders[at + 1] ?? '');
      const status = incoming.statusCode ?? 0;
      const empty = request.method === 'HEAD' || [204, 205, 304].includes(status);
      if (empty) incoming.resume();
      try {
        resolve(new Response(empty ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }));
      } catch (error) {
        outgoing.destroy();
        reject(new TypeError('fetch failed', { cause: error }));
      }
    });
    outgoing.end(body);
  });
};
