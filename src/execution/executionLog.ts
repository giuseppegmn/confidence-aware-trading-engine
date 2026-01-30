export interface ExecutionLogEntry {
  asset: string;
  action: 'EXECUTED' | 'SKIPPED';
  decision: 'ALLOW' | 'BLOCK' | 'CAUTION';
  riskScore: number;
  timestamp: number;
  reason?: string;
}

export function logExecution(entry: ExecutionLogEntry) {
  const output = {
    ...entry,
    timestamp: new Date(entry.timestamp * 1000).toISOString()
  };

  console.log('[EXECUTION]', JSON.stringify(output, null, 2));
}
