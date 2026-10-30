// TCP and TLS transport over node:net / node:tls (also Deno and Bun through
// their node: compatibility). The built-ins load lazily, so browser bundles
// never include them.
import { nodeBuiltin } from '../env/detect.ts';
import type { Transport, TransportFactory } from '../types.ts';
import { LineDecoder, parseStratumUrl } from './client.ts';

export interface NodeTransportOptions {
  /** Accept any TLS certificate, as upstream does. Default false: verify it. */
  tlsInsecure?: boolean;
  /** Default 30 s, as upstream (CURLOPT_CONNECTTIMEOUT). */
  connectTimeoutMs?: number;
}

const CONNECT_TIMEOUT_MS = 30_000;
const KEEPALIVE_MS = 50_000; // upstream sockopt_keepalive_cb

export function nodeTransport(options: NodeTransportOptions = {}): TransportFactory {
  return (url) => new NodeTransport(url, options);
}

/** One connection to a pool. onClose fires once if an open connection ends, but not after close(). */
export class NodeTransport implements Transport {
  onLine: ((line: string) => void) | null = null;
  onClose: ((error?: Error) => void) | null = null;
  private readonly url: string;
  private readonly options: NodeTransportOptions;
  private socket: any = null;
  private state: 'new' | 'connecting' | 'open' | 'closed' = 'new';

  constructor(url: string, options: NodeTransportOptions = {}) {
    this.url = url;
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.state !== 'new') throw new Error('transport already used');
    this.state = 'connecting';
    const { host, port, tls } = parseStratumUrl(this.url);
    const net = await nodeBuiltin('net');
    const lib = tls ? await nodeBuiltin('tls') : net;
    if (this.state !== 'connecting') throw new Error('connection closed');
    const socket = tls
      ? lib.connect({
          host,
          port,
          // SNI takes names only; IP addresses are still checked against the certificate.
          servername: net.isIP(host) ? undefined : host,
          rejectUnauthorized: !this.options.tlsInsecure,
        })
      : lib.connect({ host, port });
    this.socket = socket;
    let failure: Error | undefined;
    socket.on('error', (err: Error) => {
      failure ??= err;
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const ms = this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
        const ready = tls ? 'secureConnect' : 'connect';
        const timer = setTimeout(() => {
          socket.destroy(new Error(`connection to ${host}:${port} timed out after ${ms / 1000} s`));
        }, ms);
        const onReady = () => settle();
        const onClose = () => settle(failure ?? new Error(`connection to ${host}:${port} closed`));
        const settle = (err?: Error) => {
          clearTimeout(timer);
          socket.off(ready, onReady);
          socket.off('close', onClose);
          if (err) reject(err);
          else resolve();
        };
        socket.on(ready, onReady);
        socket.on('close', onClose);
      });
    } catch (err) {
      this.state = 'closed';
      this.socket = null;
      socket.destroy();
      throw err;
    }
    if (this.state !== 'connecting') {
      socket.destroy();
      throw new Error('connection closed');
    }

    this.state = 'open';
    socket.setNoDelay(true);
    socket.setKeepAlive(true, KEEPALIVE_MS);
    const lines = new LineDecoder();
    socket.on('data', (chunk: Uint8Array) => {
      let received: string[];
      try {
        received = lines.push(chunk);
      } catch (err) {
        socket.destroy(err);
        return;
      }
      for (const line of received) {
        if (this.state !== 'open') return;
        this.onLine?.(line);
      }
    });
    socket.on('close', () => {
      const wasOpen = this.state === 'open';
      this.state = 'closed';
      this.socket = null;
      const onClose = this.onClose;
      this.onClose = null;
      if (wasOpen) onClose?.(failure);
    });
  }

  send(line: string): void {
    if (this.state === 'open') this.socket.write(`${line}\n`);
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.socket?.destroy();
  }
}
