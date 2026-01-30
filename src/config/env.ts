// Node.js compatible version (temporary for CLI scripts)
export const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:3000';
export const PROGRAM_ID = process.env.VITE_PROGRAM_ID || '2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3';
export const SOLANA_RPC = process.env.VITE_SOLANA_RPC || 'https://api.devnet.solana.com';
export const SOLANA_NETWORK = (process.env.VITE_SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet-beta' | 'testnet';
export const API_KEY = process.env.VITE_API_KEY || '';
export const ENABLE_DEBUG = process.env.VITE_ENABLE_DEBUG === 'true';
export const IS_PRODUCTION = false;
export const IS_DEV = true;
export const isValidConfig = true;

export function hasRequiredConfig(): boolean {
  return !!(API_BASE_URL && PROGRAM_ID && SOLANA_RPC);
}
