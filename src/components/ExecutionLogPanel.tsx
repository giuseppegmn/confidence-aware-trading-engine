/**
 * CATE - Execution Log Panel
 * 
 * Complete audit trail of all trading decisions with:
 * - Execution status
 * - Risk decisions
 * - Signed decision hashes
 */

import React from 'react';
import { CheckCircle, XCircle, AlertCircle, Clock, ExternalLink, PlayCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCATE } from '@/lib/CATEContext';
import type { ExecutionResult } from '@/lib/CATEEngine';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatAmount(amount: bigint | number, assetId: string): string {
  const num = typeof amount === 'bigint' ? Number(amount) : amount;
  
  if (assetId.includes('BONK')) return (num / 1e9).toExponential(2);
  if (assetId.includes('SOL')) return (num / 1e9).toFixed(4);
  if (assetId.includes('BTC')) return (num / 1e8).toFixed(6);
  if (assetId.includes('ETH')) return (num / 1e9).toFixed(6);
  return num.toLocaleString();
}

function ExecutionRow({ result }: { result: ExecutionResult }) {
  const statusConfig = {
    EXECUTED: {
      icon: <CheckCircle className="w-4 h-4" />,
      color: 'text-status-allow',
      bg: 'bg-status-allow/10',
      label: 'EXECUTED',
    },
    SIMULATED: {
      icon: <PlayCircle className="w-4 h-4" />,
      color: 'text-primary',
      bg: 'bg-primary/10',
      label: 'SIMULATED',
    },
    BLOCKED: {
      icon: <XCircle className="w-4 h-4" />,
      color: 'text-status-block',
      bg: 'bg-status-block/10',
      label: 'BLOCKED',
    },
    FAILED: {
      icon: <AlertCircle className="w-4 h-4" />,
      color: 'text-status-scale',
      bg: 'bg-status-scale/10',
      label: 'FAILED',
    },
    PENDING: {
      icon: <Clock className="w-4 h-4" />,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
      label: 'PENDING',
    },
  };
  
  const config = statusConfig[result.status];
  const { intent, decision } = result;
  
  return (
    <div className="p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {/* Status Icon */}
          <div className={`p-1.5 rounded ${config.bg} ${config.color}`}>
            {config.icon}
          </div>
          
          {/* Trade Details */}
          <div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={intent.direction === 'BUY' ? 'status-allow' : 'status-block'}
              >
                {intent.direction}
              </Badge>
              <span className="font-medium text-sm">{intent.assetId}</span>
            </div>
            
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{formatTime(result.executedAt)}</span>
              <span>|</span>
              <span>Risk: {decision.riskScore.toFixed(0)}</span>
              <span>|</span>
              <span>
                Size: {formatAmount(result.actualInputAmount || intent.inputAmount, intent.assetId)}
                {decision.sizeMultiplier < 1 && result.actualInputAmount > 0n && (
                  <span className="text-status-scale ml-1">
                    ({(decision.sizeMultiplier * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
            </div>
            
            {/* Error/Block Reason */}
            {result.errorMessage && (
              <p className="mt-1 text-xs text-status-block">
                {result.errorMessage}
              </p>
            )}
            
            {/* Execution Details */}
            {(result.status === 'EXECUTED' || result.status === 'SIMULATED') && result.executionPrice && (
              <div className="mt-1 flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  @ ${result.executionPrice.toFixed(4)}
                </span>
                <span className="text-muted-foreground">
                  Slip: {((result.actualSlippageBps || 0) / 100).toFixed(2)}%
                </span>
                {result.txSignature && result.status === 'EXECUTED' && (
                  <a 
                    href={`https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary cursor-pointer hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span className="font-mono">{result.txSignature.slice(0, 8)}...</span>
                  </a>
                )}
              </div>
            )}
            
            {/* Signed Decision Hash */}
            <div className="mt-1 text-xs text-muted-foreground">
              <span>Hash: </span>
              <span className="font-mono">{decision.signedDecision.decisionHash.slice(0, 12)}...</span>
            </div>
          </div>
        </div>
        
        {/* Status Badge */}
        <Badge variant="outline" className={`${config.color} ${config.bg} border-0`}>
          {config.label}
        </Badge>
      </div>
    </div>
  );
}

export function ExecutionLogPanel() {
  const { recentExecutions, executionStats, isSimulationMode } = useCATE();
  
  return (
    <Card className="card-glow border-border h-full overflow-hidden">
      <CardHeader className="border-b border-border py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Execution Log {isSimulationMode && '(Simulation)'}
          </CardTitle>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-status-allow">
              {executionStats.executedCount + executionStats.simulatedCount} success
            </span>
            <span className="text-status-block">
              {executionStats.blockedCount} blocked
            </span>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0 h-[calc(100%-52px)]">
        {recentExecutions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No executions yet. Run a trade to see the audit log.
          </div>
        ) : (
          <ScrollArea className="h-full">
            {recentExecutions.map((result, idx) => (
              <ExecutionRow key={`${result.intent.id}-${idx}`} result={result} />
            ))}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
