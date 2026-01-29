/**
 * CATE - Oracle Real (Pyth Hermes)
 * Conecta à Pyth Network via API Hermes real
 */

// Feed IDs reais da Pyth (mainnet)
const FEEDS = {
  SOL: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
  BTC: 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU',
  ETH: 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB',
  JUP: 'g6eRCbboSwK4tSWngn773RCMexr1APQr4uA9bGZBYfo',
  BONK: '8ihFLu5FimgTQ1Unh4dVyEHUGodJ5gJQCrQf4KUVB9bN',
} as const;

type AssetSymbol = keyof typeof FEEDS;

interface PriceData {
  symbol: AssetSymbol;
  price: number;
  confidence: number;
  publishTime: number;
}

class PythOracleReal {
  private feedIds: string[];

  constructor() {
    this.feedIds = Object.values(FEEDS);
  }

  async getAllPrices(): Promise<Record<AssetSymbol, PriceData>> {
    try {
      console.log('[Oracle] Fetching real Pyth data...');
      
      // Construir URL sem codificar os colchetes (importante!)
      const queryString = this.feedIds.map(id => 'ids[]=' + id).join('&');
      const url = 'https://hermes.pyth.network/v2/updates/price/latest?' + queryString;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const updates = data.parsed || [];

      const result = {} as Record<AssetSymbol, PriceData>;

      for (const update of updates) {
        const symbol = this.getSymbolByFeedId(update.id) as AssetSymbol;
        
        if (symbol && update.price) {
          const price = this.applyExponent(update.price.price, update.price.expo);
          const confidence = this.applyExponent(update.price.conf, update.price.expo);

          result[symbol] = {
            symbol,
            price,
            confidence,
            publishTime: update.price.publish_time,
          };
        }
      }

      console.log(`[Oracle] Fetched ${Object.keys(result).length} assets`);
      return result;

    } catch (error) {
      console.error('[Oracle] Failed to fetch Pyth data:', error);
      throw new Error('Oracle connection failed');
    }
  }

  async getPrice(symbol: AssetSymbol): Promise<PriceData> {
    const prices = await this.getAllPrices();
    const price = prices[symbol];
    if (!price) throw new Error(`Price not available for ${symbol}`);
    return price;
  }

  private applyExponent(value: string, expo: number): number {
    return Number(value) * Math.pow(10, expo);
  }

  private getSymbolByFeedId(feedId: string): string | undefined {
    return Object.entries(FEEDS).find(([_, id]) => id === feedId)?.[0];
  }
}

export const pythOracle = new PythOracleReal();
export type { PriceData, AssetSymbol };
