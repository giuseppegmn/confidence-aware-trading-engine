import { HermesClient } from '@pythnetwork/hermes-client';

export interface OracleSnapshot {
  price: {
    id: string;
    price: number;
    confidence: number;
    confidenceRatio: number;
    exponent: number;
    publishTime: number;
    numPublishers: number;
  };
  timestamp: number;
}

export class PythHermesService {
  private client: HermesClient | null = null;
  private subscribers: Set<(snapshot: OracleSnapshot) => void> = new Set();
  private isRunning = false;
  private priceIds: string[] = [
    'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
    'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'  // ETH/USD
  ];

  constructor(private endpoint: string = 'https://hermes.pyth.network') {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.client = new HermesClient(this.endpoint);
    this.poll();
    
    console.log('[Hermes] Started');
  }

  stop(): void {
    this.isRunning = false;
    console.log('[Hermes] Stopped');
  }

  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        const updates = await this.client?.getLatestPriceUpdates(this.priceIds);
        this.processUpdates(updates);
      } catch (error) {
        console.error('[Hermes] Poll error:', error);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  private processUpdates(updates: any): void {
    if (!updates?.parsed) return;
    
    for (const item of updates.parsed) {
      const price = Number(item.price.price) * Math.pow(10, item.price.expo);
      const confidence = Number(item.price.conf) * Math.pow(10, item.price.expo);
      
      const snapshot: OracleSnapshot = {
        price: {
          id: item.id,
          price,
          confidence,
          confidenceRatio: (confidence / price) * 100,
          exponent: item.price.expo,
          publishTime: item.price.publish_time,
          numPublishers: 5
        },
        timestamp: Date.now()
      };
      
      this.subscribers.forEach(cb => cb(snapshot));
    }
  }

  subscribe(callback: (snapshot: OracleSnapshot) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

export const pythHermesService = new PythHermesService();
