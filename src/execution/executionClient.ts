import { executePaperTrade } from './paperExecutor';

export function runExecutionClient() {
  console.log('--- CATE Execution Client (Paper Trading) ---');

  const intents = [
    {
      asset: 'SOL/USD',
      price: 100,
      confidenceInterval: 18,
      volatility: 0.28
    },
    {
      asset: 'SOL/USD',
      price: 100,
      confidenceInterval: 1.2,
      volatility: 0.04
    }
  ];

  for (const intent of intents) {
    executePaperTrade(intent);
  }
}
