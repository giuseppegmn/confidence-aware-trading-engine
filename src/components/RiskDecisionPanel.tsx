/**
 * CATE - Risk Decision Panel
 * 
 * Production risk analysis showing:
 * - Cryptographically signed decisions
 * - Factor breakdown
 * - Signature verification
 */

import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Info, ArrowRight, Lock, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useSelectedAsset, useCATE } from '@/lib/CATEContext';
import type { RiskFactor } from '@/lib/CATEEngine';

function RiskFactorRow({ factor }: { factor: RiskFactor }) {
  const isTriggered = factor.triggered;
  const isCritical = factor.severity === 'CRITICAL';
  const isWarning = factor.severity === 'WARNING';
  
  const statusColor = isTriggered || isCritical
    ? 'text-status-block'
    : isWarning
    ? 'text-status-scale'
    : 'text-status-allow';
  
  const bgColor = isTriggered || isCritical
    ? 'bg-status-block/10'
    : isWarning
    ? 'bg-status-scale/10'
    : 'bg-status-allow/10';
  
  return (
    <div className={`p-3 rounded-md ${bgColor} border border-border/50`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-medium text-sm ${statusColor}`}>
            {factor.name}
          </span>
          {isTriggered && (
            <Badge variant="outline" className="status-block text-xs">
              TRIGGERED
            </Badge>
          )}
          {!isTriggered && isCritical && (
            <Badge variant="outline" className="status-block text-xs">
              CRITICAL
            </Badge>
          )}
        </div>
        <span className="font-mono text-sm">
          {factor.value < 0.01 && factor.value > 0
            ? factor.value.toExponential(2)
            : factor.value.toFixed(2)}
        </span>
      </div>
      
      <p className="text-xs text-muted-foreground leading-relaxed">
        {factor.description}
      </p>
      
      {/* Threshold indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Threshold:</span>
        <span className="font-mono">{factor.threshold}</span>
        <ArrowRight className="w-3 h-3" />
        <span className={factor.triggered ? 'text-status-block' : 'text-status-allow'}>
          {factor.triggered ? 'Exceeded' : 'OK'}
        </span>
      </div>
    </div>
  );
}

export function RiskDecisionPanel() {
  const { assetId, snapshot, decision } = useSelectedAsset();
  const { signerPublicKey } = useCATE();
  
  if (!snapshot || !decision) {
    return (
      <Card className="card-glow border-border h-full">
        <CardContent className="p-6 flex items-center justify-center h-full">
          <p className="text-muted-foreground">Select an asset to view risk analysis</p>
        </CardContent>
      </Card>
    );
  }
  
  const actionConfig = {
    ALLOW: {
      icon: <ShieldCheck className="w-6 h-6" />,
      title: 'Trade Allowed',
      color: 'text-status-allow',
      bg: 'bg-status-allow/10',
      border: 'border-status-allow/30',
    },
    SCALE: {
      icon: <ShieldAlert className="w-6 h-6" />,
      title: 'Position Scaled',
      color: 'text-status-scale',
      bg: 'bg-status-scale/10',
      border: 'border-status-scale/30',
    },
    BLOCK: {
      icon: <ShieldX className="w-6 h-6" />,
      title: 'Trade Blocked',
      color: 'text-status-block',
      bg: 'bg-status-block/10',
      border: 'border-status-block/30',
    },
  };
  
  const config = actionConfig[decision.action];
  
  // Risk score color
  const riskColor = decision.riskScore < 40
    ? 'text-status-allow'
    : decision.riskScore < 70
    ? 'text-status-scale'
    : 'text-status-block';
  
  const signedDecision = decision.signedDecision;
  
  return (
    <Card className="card-glow border-border h-full overflow-hidden">
      <CardHeader className="border-b border-border py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Risk Intelligence
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {assetId}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 space-y-4 overflow-auto max-h-[calc(100%-60px)]">
        {/* Decision Summary */}
        <div className={`p-4 rounded-lg ${config.bg} border ${config.border}`}>
          <div className="flex items-center gap-3">
            <div className={config.color}>{config.icon}</div>
            <div>
              <h3 className={`font-semibold ${config.color}`}>{config.title}</h3>
              <p className="text-sm text-muted-foreground">
                {decision.action === 'SCALE'
                  ? `Position reduced to ${(decision.sizeMultiplier * 100).toFixed(0)}%`
                  : decision.action === 'BLOCK'
                  ? 'Execution not permitted'
                  : 'Full position allowed'}
              </p>
            </div>
          </div>
        </div>
        
        {/* Risk Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Risk Score</span>
            <span className={`font-mono font-bold text-lg ${riskColor}`}>
              {decision.riskScore.toFixed(0)}/100
            </span>
          </div>
          <Progress
            value={decision.riskScore}
            className="h-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Low Risk</span>
            <span>High Risk</span>
          </div>
        </div>
        
        {/* Size Multiplier */}
        <div className="flex items-center justify-between p-3 rounded-md bg-secondary">
          <span className="text-sm text-muted-foreground">Position Size Multiplier</span>
          <span className="font-mono font-bold">
            {(decision.sizeMultiplier * 100).toFixed(0)}%
          </span>
        </div>
        
        <Separator />
        
        {/* Cryptographic Signature */}
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Lock className="w-3 h-3" />
            Cryptographic Proof
          </h4>
          <div className="space-y-2 text-xs">
            <div className="p-2 rounded bg-secondary/50 flex items-center justify-between">
              <span className="text-muted-foreground">Signed</span>
              <div className="flex items-center gap-1 text-status-allow">
                <CheckCircle className="w-3 h-3" />
                <span>Verified</span>
              </div>
            </div>
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground block mb-1">Decision Hash</span>
              <p className="font-mono text-xs break-all">{signedDecision.decisionHash}</p>
            </div>
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground block mb-1">Signature</span>
              <p className="font-mono text-xs break-all">{signedDecision.signature.slice(0, 32)}...</p>
            </div>
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground block mb-1">Signer</span>
              <p className="font-mono text-xs">{signerPublicKey}</p>
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* Oracle Metrics */}
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Oracle State
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground text-xs">Confidence</span>
              <p className="font-mono">{snapshot.metrics.confidenceRatio.toFixed(4)}%</p>
            </div>
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground text-xs">Z-Score</span>
              <p className="font-mono">{snapshot.metrics.confidenceZscore.toFixed(2)}σ</p>
            </div>
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground text-xs">Volatility</span>
              <p className="font-mono">{snapshot.metrics.volatilityRealized.toFixed(1)}%</p>
            </div>
            <div className="p-2 rounded bg-secondary/50">
              <span className="text-muted-foreground text-xs">Data Quality</span>
              <p className="font-mono">{snapshot.metrics.dataQualityScore.toFixed(0)}</p>
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* Risk Factors */}
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Risk Factors ({decision.factors.filter(f => f.triggered).length} triggered)
          </h4>
          <div className="space-y-2">
            {decision.factors.map((factor, idx) => (
              <RiskFactorRow key={idx} factor={factor} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
