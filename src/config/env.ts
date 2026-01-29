/**
 * Environment Configuration
 * Validates and exports environment-specific settings
 */

const requiredEnvVars = {
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID,
  VITE_SOLANA_RPC: import.meta.env.VITE_SOLANA_RPC,
  VITE_SOLANA_NETWORK: import.meta.env.VITE_SOLANA_NETWORK,
} as const;

// Validation
if (!requiredEnvVars.VITE_API_URL) {
  throw new Error('VITE_API_URL is required (backend signing API)');
}

if (!requiredEnvVars.VITE_PROGRAM_ID) {
  throw new Error('VITE_PROGRAM_ID is required');
}

if (!requiredEnvVars.VITE_SOLANA_RPC) {
  throw new Error('VITE_SOLANA_RPC is required');
}

// Export typed config
export const API_BASE_URL = requiredEnvVars.VITE_API_URL as string;
export const PROGRAM_ID = requiredEnvVars.VITE_PROGRAM_ID as string;
export const SOLANA_RPC = requiredEnvVars.VITE_SOLANA_RPC as string;
export const SOLANA_NETWORK = (requiredEnvVars.VITE_SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet-beta' | 'testnet';
export const API_KEY = (import.meta.env.VITE_API_KEY || '') as string;

// Feature flags
export const IS_PRODUCTION = import.meta.env.PROD;
export const IS_DEV = import.meta.env.DEV;

// Validation helpers
export const isValidConfig = (): boolean => {
  try {
    // Validate Program ID format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(PROGRAM_ID)) {
      console.error('Invalid PROGRAM_ID format');
      return false;
    }
    
    // Validate URLs
    new URL(API_BASE_URL);
    new URL(SOLANA_RPC);
    
    return true;
  } catch {
    return false;
  }
};

// Auto-validate on import
if (!isValidConfig()) {
  console.warn('[Config] Invalid configuration detected');
}
