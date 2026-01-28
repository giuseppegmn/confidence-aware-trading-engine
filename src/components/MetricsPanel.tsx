/**
 * CATE - Metrics Panel
 * 
 * Production metrics dashboard showing:
 * - Decision statistics
 * - Risk scores
 * - Execution rates
 * - System health
 */

import React from 'react';
import { TrendingUp, ShieldCheck, ShieldX, Activity, Percent, AlertTriangle, Timer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useCATE, useSystemMetrics } from '@/lib/CATEContext';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

function MetricCard({ title, value, subtitle, icon, variant = 'default' }: MetricCardProps) {
  const variantStyles = {
    default: 'border-border',
    success: 'border-status-allow/30',
    warning: 'border-status-scale/30',
    danger: 'border-status-block/30',
  };
  
  const iconStyles = {
    default: 'text-primary',
    success: 'text-status-allow',
    warning: 'text-status-scale',
    danger: 'text-status-block',
  };
  
  return (
    <Card className={`card-glow border ${variantStyles[variant]}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className="text-2xl font-bold number-display">
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          <div className={`p-2 rounded-md bg-secondary ${iconStyles[variant]}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricsPanel() {
  const { executionStats, decisions, circuitStatus } = useCATE();
  const { metrics, oracleConnected, avgRiskScore, blockRate, uptimeSeconds } = useSystemMetrics();
  
  // Calculate metrics
  const totalDecisions = decisions.size;
  const allowCount = Array.from(decisions.values()).filter(d => d.action === 'ALLOW').length;
  const scaleCount = Array.from(decisions.values()).filter(d => d.action === 'SCALE').length;
  const blockCount = Array.from(decisions.values()).filter(d => d.action === 'BLOCK').length;
  
  // Success rate from execution stats
  const successRate = executionStats.totalTrades > 0
    ? ((executionStats.executedCount + executionStats.simulatedCount) / executionStats.totalTrades) * 100
    : 100;
  
  // Determine variants based on values
  const riskVariant = avgRiskScore < 40 ? 'success' : avgRiskScore < 70 ? 'warning' : 'danger';
  const successVariant = successRate > 80 ? 'success' : successRate > 50 ? 'warning' : 'danger';
  const circuitVariant = circuitStatus.state === 'CLOSED' ? 'success' : circuitStatus.state === 'HALF_OPEN' ? 'warning' : 'danger';
  
  // Format uptime
  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
      <MetricCard
        title="Oracle Feed"
        value={oracleConnected ? 'LIVE' : 'OFFLINE'}
        subtitle={`${totalDecisions} assets monitored`}
        icon={<Activity className="w-5 h-5" />}
        variant={oracleConnected ? 'success' : 'danger'}
      />
      
      <MetricCard
        title="Avg Risk Score"
        value={avgRiskScore.toFixed(1)}
        subtitle={`/100 - ${riskVariant === 'success' ? 'Healthy' : riskVariant === 'warning' ? 'Elevated' : 'Critical'}`}
        icon={<TrendingUp className="w-5 h-5" />}
        variant={riskVariant}
      />
      
      <MetricCard
        title="Trades Allowed"
        value={allowCount + scaleCount}
        subtitle={`${scaleCount} scaled / ${blockCount} blocked`}
        icon={<ShieldCheck className="w-5 h-5" />}
        variant="success"
      />
      
      <MetricCard
        title="Block Rate"
        value={`${(blockRate * 100).toFixed(1)}%`}
        subtitle={`${metrics.blockedTradesCount} trades blocked`}
        icon={<ShieldX className="w-5 h-5" />}
        variant={blockRate > 0.3 ? 'danger' : blockRate > 0.1 ? 'warning' : 'success'}
      />
      
      <MetricCard
        title="Circuit Breaker"
        value={circuitStatus.state}
        subtitle={circuitStatus.reason.slice(0, 30)}
        icon={<AlertTriangle className="w-5 h-5" />}
        variant={circuitVariant}
      />
      
      <MetricCard
        title="Uptime"
        value={formatUptime(uptimeSeconds)}
        subtitle={`${executionStats.totalTrades} total trades`}
        icon={<Timer className="w-5 h-5" />}
        variant="default"
      />
    </div>
  );
}
