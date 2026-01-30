/**
 * CATE - Oracle Real (Pyth Hermes)
 * Múltiplos ativos: SOL, BTC, ETH, JUP, BONK, PYTH
 */

const FEEDS = {
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  JUP: '0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  BONK: '0x72b021217ca3fe68922a19aaf50910e480c102c47971c6d7748c09457b62d485',
  PYTH: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a', // PYTH/USD
} as const;

type AssetSymbol = keyof typeof FEEDS;

interface PriceData {
  symbol: AssetSymbol;
  price: number;
  confidence: number;
  publishTime: number;
}

class PythOracleReal {
  async getPrice(symbol: AssetSymbol): Promise<PriceData> {
    console.log(`[Oracle] Fetching ${symbol} from Pyth...`);
    
    const feedId = FEEDS[symbol];
    const url = `https://hermes.pyth.network/api/latest_price_feeds?ids[]=${feedId}`;
    
    console.log(`[Oracle] URL: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const feed = data[0];
    
    if (!feed || !feed.price) {
      throw new Error('No price data received');
    }
    
    const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
    const confidence = Number(feed.price.conf) * Math.pow(10, feed.price.expo);
    
    console.log(`[Oracle] ${symbol}: $${price.toFixed(2)} | Confidence: ${confidence.toFixed(4)}`);
    
    return {
      symbol,
      price,
      confidence,
      publishTime: feed.price.publish_time,
    };
  }
  
  // Buscar todos de uma vez
  async getAllPrices(): Promise<Record<AssetSymbol, PriceData>> {
    const symbols = Object.keys(FEEDS) as AssetSymbol[];
    const results = await Promise.all(symbols.map(s => this.getPrice(s)));
    
    return results.reduce((acc, data) => {
      acc[data.symbol] = data;
      return acc;
    }, {} as Record<AssetSymbol, PriceData>);
  }
}

export const pythOracle = new PythOracleReal();
export type { PriceData, AssetSymbol };
