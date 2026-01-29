/**
 * CATE - Solana Program Configuration
 * 
 * On-chain Trust Layer addresses and configuration
 */

// Program ID for CATE Trust Layer (deployed on devnet)
export const PROGRAM_ID = '2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3';

// Network configuration
export const NETWORK = 'devnet';
export const RPC_ENDPOINT = 'https://api.devnet.solana.com';

// Config PDA will be derived from seeds ["config"]
// It needs to be initialized by calling initializeConfig instruction
export const configAddress = null; // Set after initialization
