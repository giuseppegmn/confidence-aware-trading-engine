/**
 * Environment configuration
 * All sensitive config must come from build-time env vars
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const API_KEY = import.meta.env.VITE_API_KEY || '';

// Validation
if (!API_BASE_URL) {
  throw new Error('VITE_API_URL is required');
}

// In production, require API key
if (import.meta.env.PROD && !API_KEY) {
  console.warn('[Config] API_KEY not set in production');
}
