/**
 * CATE - Oracle Feed Panel
 * 
 * Real-time Pyth Hermes price feeds with:
 * - Live prices and confidence intervals
 * - Data freshness indicators
 * - Risk status badges
 */

import React from 'react';
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle, MinusCircle, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCATE } from '@/lib/CATEContext';
import type { OracleSnapshot, RiskDecision, AssetConfig } from '@/lib/CATEEngine';

interface AssetRowProps {
  asset: AssetConfig;
  snapshot: OracleSnapshot | undefined;
  decision: RiskDecision | undefined;
  isSelected: boolean;
  onSelect: () => void;
}

function AssetRow({ asset, snapshot, decision, isSelected, onSelect }: AssetRowProps) {
  if (!snapshot) {
    return (
      <div className="p-3 border-b border-border/50 opacity-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <WifiOff className="w-4 h-4 text-muted-foreground" />
          </div>
          <span className="text-muted-foreground">Waiting for {asset.symbol}...</span>
        </div>
      </div>
    );
  }
  
  const { price, metrics } = snapshot;
  const priceChange = metrics.priceChange1h;
  const isPositive = priceChange >= 0;
  const dataAge = metrics.dataFreshnessSeconds;
  const isStale = dataAge > 30;
  
  // Format price based on value
  const formatPrice = (p: number) => {
    if (p < 0.0001) return p.toExponential(4);
    if (p < 1) return p.toFixed(6);
    if (p < 100) return p.toFixed(4);
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  // Decision status
  const statusIcon = {
    ALLOW: <CheckCircle className="w-4 h-4 text-status-allow" />,
    SCALE: <MinusCircle className="w-4 h-4 text-status-scale" />,
    BLOCK: <AlertCircle className="w-4 h-4 text-status-block" />,
  }[decision?.action || 'ALLOW'];
  
  const statusClass = {
    ALLOW: 'status-allow',
    SCALE: 'status-scale',
    BLOCK: 'status-block',
  }[decision?.action || 'ALLOW'];
  
  return (
    <div
      onClick={onSelect}
      className={`p-3 border-b border-border/50 cursor-pointer transition-colors hover:bg-secondary/50 ${
        isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        {/* Asset Info */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <span className="text-xs font-bold text-primary">
              {asset.symbol.slice(0, 2)}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{asset.symbol}</span>
              <Badge variant="outline" className={`text-xs px-1.5 py-0 ${statusClass}`}>
                {decision?.action || '...'}
              </Badge>
              {isStale && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 status-block">
                  STALE
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{asset.name}</span>
              <span className="text-primary/50">|</span>
              <span className={price.source === 'PYTH_HERMES' ? 'text-status-allow' : 'text-status-scale'}>
                {price.source === 'PYTH_HERMES' ? 'LIVE' : price.source}
              </span>
            </div>
          </div>
        </div>
        
        {/* Price & Confidence */}
        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <span className="font-mono font-medium">${formatPrice(price.price)}</span>
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-status-allow" />
            ) : (
              <TrendingDown className="w-4 h-4 text-status-block" />
            )}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <span className={`text-xs font-mono ${
              isPositive ? 'text-status-allow' : 'text-status-block'
            }`}>
              {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
            <span className="text-xs text-muted-foreground">
              ±{metrics.confidenceRatio.toFixed(3)}%
            </span>
          </div>
        </div>
      </div>
      
      {/* Metrics Bar */}
      <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <span className="text-muted-foreground">Fresh</span>
          <p className={`font-mono ${isStale ? 'text-status-block' : 'text-foreground'}`}>
            {dataAge.toFixed(1)}s
          </p>
        </div>
        <div className="text-center">
          <span className="text-muted-foreground">Risk</span>
          <p className={`font-mono ${
            (decision?.riskScore || 0) < 40 ? 'text-status-allow' :
            (decision?.riskScore || 0) < 70 ? 'text-status-scale' : 'text-status-block'
          }`}>
            {decision?.riskScore.toFixed(0) || '--'}
          </p>
        </div>
        <div className="text-center">
          <span className="text-muted-foreground">Vol</span>
          <p className="font-mono">{metrics.volatilityRealized.toFixed(0)}%</p>
        </div>
        <div className="text-center">
          <span className="text-muted-foreground">Quality</span>
          <p className={`font-mono ${
            metrics.dataQualityScore > 70 ? 'text-status-allow' :
            metrics.dataQualityScore > 40 ? 'text-status-scale' : 'text-status-block'
          }`}>
            {metrics.dataQualityScore.toFixed(0)}
          </p>
        </div>
      </div>
      
      {/* Confidence Bar */}
      <div className="mt-2">
        <div className="confidence-bar">
          <div
            className="confidence-bar-fill"
            style={{
              width: `${Math.min(100, (1 - metrics.confidenceRatio / 5) * 100)}%`,
              background: metrics.confidenceRatio < 1
                ? 'hsl(var(--status-allow))'
                : metrics.confidenceRatio < 3
                ? 'hsl(var(--status-scale))'
                : 'hsl(var(--status-block))',
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function OracleFeedPanel() {
  const { snapshots, decisions, selectedAsset, setSelectedAsset, supportedAssets, engineStatus } = useCATE();
  
  const oracleConnected = engineStatus.oracleStatus === 'CONNECTED';
  
  return (
    <Card className="card-glow border-border h-full">
      <CardHeader className="border-b border-border py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Pyth Hermes Feeds
          </CardTitle>
          <div className="flex items-center gap-2">
            {oracleConnected ? (
              <>
                <Wifi className="w-4 h-4 text-status-allow" />
                <span className="text-xs text-status-allow">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-status-block" />
                <span className="text-xs text-status-block">Offline</span>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/50">
          {supportedAssets.map(asset => (
            <AssetRow
              key={asset.id}
              asset={asset}
              snapshot={snapshots.get(asset.id)}
              decision={decisions.get(asset.id)}
              isSelected={selectedAsset === asset.id}
              onSelect={() => setSelectedAsset(asset.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
