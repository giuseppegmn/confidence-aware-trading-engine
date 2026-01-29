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
    volatility24h: number; // NOVO: volatilidade calculada
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
  
  // NOVO: Histórico de preços para calcular volatilidade
  private priceHistory: Map<string, number[]> = new Map();
  private readonly HISTORY_SIZE = 20; // Últimos 20 preços

  constructor(private endpoint: string = 'https://hermes.pyth.network') {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.client = new HermesClient(this.endpoint);
    this.poll();
    
    console.log('[Hermes] Started with volatility tracking');
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
      const id = item.id;
      
      // NOVO: Atualiza histórico e calcula volatilidade
      this.updatePriceHistory(id, price);
      const volatility = this.calculateVolatility(id);
      
      const snapshot: OracleSnapshot = {
        price: {
          id,
          price,
          confidence,
          confidenceRatio: (confidence / price) * 100,
          exponent: item.price.expo,
          publishTime: item.price.publish_time,
          numPublishers: 5,
          volatility24h: volatility // NOVO!
        },
        timestamp: Date.now()
      };
      
      this.subscribers.forEach(cb => cb(snapshot));
    }
  }

  // NOVO: Guarda histórico de preços
  private updatePriceHistory(id: string, price: number): void {
    if (!this.priceHistory.has(id)) {
      this.priceHistory.set(id, []);
    }
    
    const history = this.priceHistory.get(id)!;
    history.push(price);
    
    // Mantém apenas os últimos N preços
    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }
  }

  // NOVO: Calcula volatilidade (desvio padrão relativo)
  private calculateVolatility(id: string): number {
    const history = this.priceHistory.get(id);
    if (!history || history.length < 5) return 0;
    
    // Calcula média
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    
    // Calcula desvio padrão
    const squaredDiffs = history.map(p => Math.pow(p - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / history.length;
    const stdDev = Math.sqrt(variance);
    
    // Volatilidade relativa (%) - quanto maior, mais volátil
    const volatility = (stdDev / mean) * 100;
    
    return parseFloat(volatility.toFixed(2));
  }

  subscribe(callback: (snapshot: OracleSnapshot) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

export const pythHermesService = new PythHermesService();
