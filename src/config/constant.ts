// Ambiente controlado via build args
export const IS_PRODUCTION = import.meta.env.PROD;
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Chave pública do signatário (obtida dinamicamente do backend em produção)
export const TRUSTED_SIGNER_PUBKEY = IS_PRODUCTION 
  ? null // Obtido via /health no startup
  : '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'; // Dev only
