/**
 * Environment Configuration
 * Validates and exports environment-specific settings
 */

// =============================================================================
// FRONTEND CONFIG (VITE_ prefixed vars)
// =============================================================================

const requiredEnvVars = {
  API_URL: import.meta.env.VITE_API_URL,
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID,
  SOLANA_RPC: import.meta.env.VITE_SOLANA_RPC,
  NETWORK: import.meta.env.VITE_SOLANA_NETWORK || 'devnet',
} as const;

// Validation - fail fast on missing required vars
function validateConfig() {
  const errors: string[] = [];

  if (!requiredEnvVars.API_URL) {
    errors.push('VITE_API_URL is required (backend signing API URL)');
  }

  if (!requiredEnvVars.PROGRAM_ID) {
    errors.push('VITE_PROGRAM_ID is required (deployed program address)');
  }

  if (!requiredEnvVars.SOLANA_RPC) {
    errors.push('VITE_SOLANA_RPC is required (Solana RPC endpoint)');
  }

  // Validate Program ID format (base58, 32-44 chars)
  if (requiredEnvVars.PROGRAM_ID && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(requiredEnvVars.PROGRAM_ID)) {
    errors.push('VITE_PROGRAM_ID must be a valid base58-encoded Solana address');
  }

  // Validate URLs format
  try {
    if (requiredEnvVars.API_URL) new URL(requiredEnvVars.API_URL);
    if (requiredEnvVars.SOLANA_RPC) new URL(requiredEnvVars.SOLANA_RPC);
  } catch {
    errors.push('VITE_API_URL and VITE_SOLANA_RPC must be valid URLs');
  }

  if (errors.length > 0) {
    console.error('[Config] Environment validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    
    if (import.meta.env.PROD) {
      throw new Error(`Configuration Error: ${errors.join(', ')}`);
    } else {
      console.warn('[Config] Running in DEV mode with partial config');
    }
  }

  return errors.length === 0;
}

// Run validation
export const isValidConfig = validateConfig();

// =============================================================================
// EXPORTS
// =============================================================================

export const API_BASE_URL = requiredEnvVars.API_URL as string;
export const PROGRAM_ID = requiredEnvVars.PROGRAM_ID as string;
export const SOLANA_RPC = requiredEnvVars.SOLANA_RPC as string;
export const SOLANA_NETWORK = requiredEnvVars.NETWORK as 'devnet' | 'mainnet-beta' | 'testnet';
export const API_KEY = (import.meta.env.VITE_API_KEY || '') as string;
export const ENABLE_DEBUG = import.meta.env.VITE_ENABLE_DEBUG === 'true';

// Feature flags
export const IS_PRODUCTION = import.meta.env.PROD;
export const IS_DEV = import.meta.env.DEV;

// Helper to check if config is complete
export const hasRequiredConfig = (): boolean => {
  return !!(API_BASE_URL && PROGRAM_ID && SOLANA_RPC);
};

// Warning if running without backend API in production
if (IS_PRODUCTION && !API_BASE_URL) {
  console.error('🚨 CRITICAL: VITE_API_URL not set. Private key exposure risk if signing locally!');
}
