import { evaluateRisk } from '../lib/risk/engine';

export type DemoScenario = 'STABLE' | 'UNSTABLE';

export function runDemoScenario(scenario: DemoScenario) {
  if (scenario === 'UNSTABLE') {
    return evaluateRisk({
      price: 100,
      confidenceInterval: 15,
      volatility: 0.25
    });
  }

  return evaluateRisk({
    price: 100,
    confidenceInterval: 1,
    volatility: 0.03
  });
}
