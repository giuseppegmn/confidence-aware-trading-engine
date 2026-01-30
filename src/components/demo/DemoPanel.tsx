import { useState } from 'react';
import { runDemoScenario } from '../../demo/demoEngine';

type Scenario = 'UNSTABLE' | 'STABLE';

export default function DemoPanel() {
  const [scenario, setScenario] = useState<Scenario>('UNSTABLE');
  const result = runDemoScenario(scenario);

  const isBlocked = result.decision === 'BLOCK';

  return (
    <div className='rounded-xl border p-6 space-y-4'>
      <h2 className='text-xl font-semibold'>
        Guided Risk Demo
      </h2>

      <p className='text-sm text-gray-500'>
        Toggle market conditions to see how oracle uncertainty
        affects execution decisions.
      </p>

      <button
        className='px-4 py-2 rounded-lg border font-medium'
        onClick={() =>
          setScenario(scenario === 'UNSTABLE' ? 'STABLE' : 'UNSTABLE')
        }
      >
        Switch to {scenario === 'UNSTABLE' ? 'STABLE' : 'UNSTABLE'} Market
      </button>

      <div className='rounded-lg p-4 bg-gray-50 space-y-2'>
        <div>
          <strong>Scenario:</strong> {scenario}
        </div>

        <div>
          <strong>Risk Score:</strong> {result.riskScore}
        </div>

        <div>
          <strong>Decision:</strong>{' '}
          <span
            className={
              isBlocked ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'
            }
          >
            {result.decision}
          </span>
        </div>
      </div>
    </div>
  );
}
