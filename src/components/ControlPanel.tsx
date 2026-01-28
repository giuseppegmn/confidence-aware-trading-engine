/**
 * CATE - Control Panel
 * 
 * Production controls including:
 * - Trade execution
 * - Circuit breaker controls
 * - Emergency stop
 * - Risk parameter adjustment
 */

import React, { useState } from 'react';
import { 
  Play, Pause, Zap, AlertTriangle, Settings, 
  StopCircle, RefreshCw, Shield, AlertOctagon 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCATE, useCircuitBreaker, useSelectedAsset } from '@/lib/CATEContext';

export function ControlPanel() {
  const {
    isRunning,
    startEngine,
    stopEngine,
    executeDemoTrade,
    riskParams,
    updateRiskParams,
    isSimulationMode,
    setSimulationMode,
  } = useCATE();
  
  const { status: circuitStatus, emergencyStop, reset: resetCircuitBreaker, isOpen } = useCircuitBreaker();
  const { assetId } = useSelectedAsset();
  
  const [isExecuting, setIsExecuting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const handleDemoTrade = async () => {
    setIsExecuting(true);
    try {
      await executeDemoTrade();
    } finally {
      setIsExecuting(false);
    }
  };
  
  const handleBatchTrades = async () => {
    setIsExecuting(true);
    try {
      for (let i = 0; i < 5; i++) {
        await executeDemoTrade();
        await new Promise(r => setTimeout(r, 300));
      }
    } finally {
      setIsExecuting(false);
    }
  };
  
  const handleEmergencyStop = () => {
    emergencyStop('Manual emergency stop triggered');
  };
  
  return (
    <Card className="card-glow border-border">
      <CardHeader className="border-b border-border py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Engine Controls
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 space-y-4">
        {/* Engine & Mode Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant={isRunning ? 'outline' : 'default'}
              size="sm"
              onClick={isRunning ? stopEngine : startEngine}
            >
              {isRunning ? (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start
                </>
              )}
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <Label htmlFor="sim-mode" className="text-xs text-muted-foreground">
              Simulation
            </Label>
            <Switch
              id="sim-mode"
              checked={isSimulationMode}
              onCheckedChange={setSimulationMode}
            />
          </div>
        </div>
        
        <Separator />
        
        {/* Circuit Breaker Status */}
        <div className={`p-3 rounded-md ${
          circuitStatus.state === 'CLOSED' ? 'bg-status-allow/10' :
          circuitStatus.state === 'HALF_OPEN' ? 'bg-status-scale/10' :
          'bg-status-block/10'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className={`w-4 h-4 ${
                circuitStatus.state === 'CLOSED' ? 'text-status-allow' :
                circuitStatus.state === 'HALF_OPEN' ? 'text-status-scale' :
                'text-status-block'
              }`} />
              <span className="text-sm font-medium">Circuit Breaker</span>
            </div>
            <span className={`text-xs font-bold ${
              circuitStatus.state === 'CLOSED' ? 'text-status-allow' :
              circuitStatus.state === 'HALF_OPEN' ? 'text-status-scale' :
              'text-status-block'
            }`}>
              {circuitStatus.state}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {circuitStatus.reason.slice(0, 50)}
          </p>
          {circuitStatus.failureCount > 0 && (
            <p className="text-xs text-status-scale">
              Failures: {circuitStatus.failureCount}
            </p>
          )}
        </div>
        
        {/* Emergency Controls */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleEmergencyStop}
            disabled={isOpen}
            className="flex-1"
          >
            <AlertOctagon className="w-4 h-4 mr-2" />
            Emergency Stop
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={resetCircuitBreaker}
            disabled={circuitStatus.state === 'CLOSED'}
            className="flex-1"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset
          </Button>
        </div>
        
        <Separator />
        
        {/* Trade Execution */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Execute Trades</Label>
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={handleDemoTrade}
              disabled={!isRunning || isExecuting || isOpen}
            >
              <Zap className="w-4 h-4 mr-2" />
              {isSimulationMode ? 'Simulate' : 'Execute'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchTrades}
              disabled={!isRunning || isExecuting || isOpen}
            >
              x5
            </Button>
          </div>
          {isOpen && (
            <p className="text-xs text-status-block mt-2">
              Trading blocked - circuit breaker open
            </p>
          )}
        </div>
        
        {/* Settings Panel */}
        {showSettings && (
          <>
            <Separator />
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">Risk Parameters</Label>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Max Conf Ratio (Scale)</span>
                  <span className="font-mono">{riskParams.maxConfidenceRatioScale}%</span>
                </div>
                <Slider
                  value={[riskParams.maxConfidenceRatioScale]}
                  min={0.1}
                  max={5}
                  step={0.1}
                  onValueChange={([v]) => updateRiskParams({ maxConfidenceRatioScale: v })}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Max Conf Ratio (Block)</span>
                  <span className="font-mono">{riskParams.maxConfidenceRatioBlock}%</span>
                </div>
                <Slider
                  value={[riskParams.maxConfidenceRatioBlock]}
                  min={1}
                  max={10}
                  step={0.5}
                  onValueChange={([v]) => updateRiskParams({ maxConfidenceRatioBlock: v })}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Max Z-Score</span>
                  <span className="font-mono">{riskParams.maxConfidenceZscore}σ</span>
                </div>
                <Slider
                  value={[riskParams.maxConfidenceZscore]}
                  min={1}
                  max={5}
                  step={0.5}
                  onValueChange={([v]) => updateRiskParams({ maxConfidenceZscore: v })}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Max Staleness</span>
                  <span className="font-mono">{riskParams.maxStalenessSeconds}s</span>
                </div>
                <Slider
                  value={[riskParams.maxStalenessSeconds]}
                  min={5}
                  max={120}
                  step={5}
                  onValueChange={([v]) => updateRiskParams({ maxStalenessSeconds: v })}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Min Data Quality</span>
                  <span className="font-mono">{riskParams.minDataQualityScore}</span>
                </div>
                <Slider
                  value={[riskParams.minDataQualityScore]}
                  min={0}
                  max={100}
                  step={10}
                  onValueChange={([v]) => updateRiskParams({ minDataQualityScore: v })}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
