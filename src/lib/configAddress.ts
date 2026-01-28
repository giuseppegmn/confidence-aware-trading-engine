/**
 * CATE - Solana Program Configuration
 * 
 * On-chain Trust Layer addresses and configuration
 */

// Program ID for CATE Trust Layer (deployed on devnet)
export const PROGRAM_ID = '77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6';

// Network configuration
export const NETWORK = 'devnet';
export const RPC_ENDPOINT = 'https://api.devnet.solana.com';

// Config PDA will be derived from seeds ["config"]
// It needs to be initialized by calling initializeConfig instruction
export const configAddress = null; // Set after initialization
