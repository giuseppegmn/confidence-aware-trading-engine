import { evaluateRisk } from '../lib/risk/engine';
import { logExecution } from './executionLog';

export interface TradeIntent {
  asset: string;
  price: number;
  confidenceInterval: number;
  volatility: number;
}

export function executePaperTrade(intent: TradeIntent) {
  const risk = evaluateRisk({
    price: intent.price,
    confidenceInterval: intent.confidenceInterval,
    volatility: intent.volatility
  });

  const timestamp = Math.floor(Date.now() / 1000);

  if (risk.decision === 'BLOCK') {
    logExecution({
      asset: intent.asset,
      action: 'SKIPPED',
      decision: risk.decision,
      riskScore: risk.riskScore,
      timestamp,
      reason: 'ORACLE_UNCERTAINTY'
    });

    return;
  }

  logExecution({
    asset: intent.asset,
    action: 'EXECUTED',
    decision: risk.decision,
    riskScore: risk.riskScore,
    timestamp
  });
}
