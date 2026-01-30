/**
 * CATE - Risk Decision Panel
 */

import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Lock, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useCATE } from '@/lib/CATEContext';

export function RiskDecisionPanel() {
  const { lastDecision, signerKey, selectedAsset } = useCATE();

  if (!lastDecision) {
    return (
      <Card className="border-slate-800 bg-slate-900/50 h-full">
        <CardContent className="p-6 flex items-center justify-center h-full">
          <p className="text-slate-500">Click &quot;Simulate&quot; to view risk analysis</p>
        </CardContent>
      </Card>
    );
  }

  const decision = lastDecision;

  const actionConfig = {
    ALLOW: {
      icon: <ShieldCheck className="w-6 h-6" />,
      title: 'Trade Allowed',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
    },
    SCALE: {
      icon: <ShieldAlert className="w-6 h-6" />,
      title: 'Position Scaled',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
    },
    BLOCK: {
      icon: <ShieldX className="w-6 h-6" />,
      title: 'Trade Blocked',
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
    },
  };

  const config = actionConfig[decision.action] || actionConfig.BLOCK;

  const riskColor = decision.riskScore < 40
    ? 'text-emerald-400'
    : decision.riskScore < 70
    ? 'text-amber-400'
    : 'text-red-400';

  return (
    <Card className="border-slate-800 bg-slate-900/50 h-full overflow-hidden">
      <CardHeader className="border-b border-slate-800 py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-slate-500">
            Risk Intelligence
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {selectedAsset}/USD
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
              <p className="text-sm text-slate-400">
                {decision.action === 'SCALE'
                  ? `Position reduced to ${((decision.sizeMultiplier || 0.5) * 100).toFixed(0)}%`
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
            <span className="text-sm text-slate-500">Risk Score</span>
            <span className={`font-mono font-bold text-lg ${riskColor}`}>
              {decision.riskScore}/100
            </span>
          </div>
          <Progress value={decision.riskScore} className="h-2" />
        </div>

        {/* Size Multiplier */}
        <div className="flex items-center justify-between p-3 rounded-md bg-slate-800">
          <span className="text-sm text-slate-500">Position Size Multiplier</span>
          <span className="font-mono font-bold">
            {((decision.sizeMultiplier || 1) * 100).toFixed(0)}%
          </span>
        </div>

        <Separator className="bg-slate-800" />

        {/* Cryptographic Signature */}
        {decision.signature && (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
              <Lock className="w-3 h-3" />
              Cryptographic Proof
            </h4>
            <div className="space-y-2 text-xs">
              <div className="p-2 rounded bg-slate-800/50 flex items-center justify-between">
                <span className="text-slate-500">Signed</span>
                <div className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle className="w-3 h-3" />
                  <span>Verified</span>
                </div>
              </div>
              <div className="p-2 rounded bg-slate-800/50">
                <span className="text-slate-500 block mb-1">Signature</span>
                <p className="font-mono text-xs break-all">
                  {typeof decision.signature === 'string' 
                    ? decision.signature.slice(0, 32) + '...'
                    : 'Available'}
                </p>
              </div>
              <div className="p-2 rounded bg-slate-800/50">
                <span className="text-slate-500 block mb-1">Signer</span>
                <p className="font-mono text-xs">{signerKey?.slice(0, 20)}...</p>
              </div>
            </div>
          </div>
        )}

        <Separator className="bg-slate-800" />

        {/* Explanation */}
        <div className="p-3 rounded bg-slate-800/50">
          <span className="text-xs text-slate-500 block mb-1">Explanation</span>
          <p className="text-sm text-slate-300">{decision.explanation}</p>
        </div>
      </CardContent>
    </Card>
  );
}
