/** Solana Explorer URL builder. Only localnet and Devnet are supported: this project never touches real money. */
import type { SolanaCluster } from './events.js';

export class ExplorerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExplorerUrlError';
  }
}

export type ExplorerTarget = 'tx' | 'address';

export interface ExplorerOptions {
  /** RPC URL of the local validator for `localnet` links. Default http://127.0.0.1:8899. */
  localnetRpcUrl?: string;
  /** Explorer origin. Default https://explorer.solana.com. */
  baseUrl?: string;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const DEFAULT_BASE = 'https://explorer.solana.com';
const DEFAULT_LOCAL_RPC = 'http://127.0.0.1:8899';

export function isPlausibleSignature(sig: string): boolean {
  return BASE58.test(sig) && sig.length >= 64 && sig.length <= 90;
}
export function isPlausibleAddress(addr: string): boolean {
  return BASE58.test(addr) && addr.length >= 32 && addr.length <= 44;
}

export function buildExplorerUrl(cluster: SolanaCluster, target: ExplorerTarget, id: string, options: ExplorerOptions = {}): string {
  if (cluster !== 'localnet' && cluster !== 'devnet') {
    throw new ExplorerUrlError(`Unsupported cluster "${String(cluster)}": only localnet and devnet are allowed`);
  }
  if (target === 'tx' ? !isPlausibleSignature(id) : !isPlausibleAddress(id)) {
    throw new ExplorerUrlError(`Not a valid base58 Solana ${target === 'tx' ? 'signature' : 'address'}`);
  }
  const base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/?#]+$/.test(base)) throw new ExplorerUrlError('baseUrl must be an https origin');
  const path = `${base}/${target === 'tx' ? 'tx' : 'address'}/${id}`;
  if (cluster === 'devnet') return `${path}?cluster=devnet`;
  const rpc = options.localnetRpcUrl ?? DEFAULT_LOCAL_RPC;
  if (!/^https?:\/\/[^\s]+$/.test(rpc)) throw new ExplorerUrlError('localnetRpcUrl must be an http(s) URL');
  return `${path}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
}

export const explorerTxUrl = (cluster: SolanaCluster, signature: string, options?: ExplorerOptions): string =>
  buildExplorerUrl(cluster, 'tx', signature, options);
export const explorerAddressUrl = (cluster: SolanaCluster, address: string, options?: ExplorerOptions): string =>
  buildExplorerUrl(cluster, 'address', address, options);
