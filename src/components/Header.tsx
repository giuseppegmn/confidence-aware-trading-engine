/**
 * CATE - Header Component
 * 
 * Production system status bar with:
 * - Oracle connection status
 * - Circuit breaker state
 * - Engine signer info
 * - Wallet connection
 */

import React from 'react';
import { Activity, Shield, Zap, AlertTriangle, Lock, Wifi, WifiOff } from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useCATE, useCircuitBreaker } from '@/lib/CATEContext';

export function Header() {
  const { engineStatus, isRunning, signerPublicKey, isSimulationMode } = useCATE();
  const { status: circuitStatus, isOpen } = useCircuitBreaker();
  
  const oracleConnected = engineStatus.oracleStatus === 'CONNECTED';
  
  const systemStatus = isOpen 
    ? 'CRITICAL' 
    : !oracleConnected 
    ? 'DEGRADED' 
    : 'OPERATIONAL';
  
  const statusColor = {
    OPERATIONAL: 'text-status-allow',
    DEGRADED: 'text-status-scale',
    CRITICAL: 'text-status-block',
  }[systemStatus];
  
  const statusBg = {
    OPERATIONAL: 'bg-status-allow/10',
    DEGRADED: 'bg-status-scale/10',
    CRITICAL: 'bg-status-block/10',
  }[systemStatus];
  
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Shield className="w-8 h-8 text-primary" />
              <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                isRunning && oracleConnected ? 'bg-status-allow animate-pulse' : 'bg-status-block'
              }`} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-primary">CATE</span>
                <span className="text-muted-foreground font-normal ml-2 text-sm hidden sm:inline">
                  Confidence-Aware Trading Engine
                </span>
              </h1>
            </div>
          </div>
          
          {/* Status Indicators */}
          <div className="flex items-center gap-3">
            {/* Simulation Mode Badge */}
            {isSimulationMode && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-status-scale/10 border border-status-scale/30">
                <span className="text-xs font-medium text-status-scale">SIMULATION</span>
              </div>
            )}
            
            {/* Oracle Status */}
            <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md ${
              oracleConnected ? 'bg-status-allow/10' : 'bg-status-block/10'
            }`}>
              {oracleConnected ? (
                <Wifi className="w-4 h-4 text-status-allow" />
              ) : (
                <WifiOff className="w-4 h-4 text-status-block" />
              )}
              <span className={`text-xs font-medium ${
                oracleConnected ? 'text-status-allow' : 'text-status-block'
              }`}>
                {oracleConnected ? 'PYTH LIVE' : 'OFFLINE'}
              </span>
            </div>
            
            {/* Circuit Breaker */}
            {isOpen && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-status-block/20 border border-status-block/50">
                <AlertTriangle className="w-4 h-4 text-status-block animate-pulse" />
                <span className="text-xs font-bold text-status-block">
                  CIRCUIT OPEN
                </span>
              </div>
            )}
            
            {/* System Status */}
            <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md ${statusBg}`}>
              <Activity className={`w-4 h-4 ${statusColor}`} />
              <span className={`text-sm font-medium ${statusColor}`}>
                {systemStatus}
              </span>
            </div>
            
            {/* Latency */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono text-muted-foreground">
                {engineStatus.metrics.oracleHealth.connected 
                  ? `${Math.floor((Date.now() - engineStatus.metrics.oracleHealth.lastUpdate) / 100) / 10}s`
                  : '--'}
              </span>
            </div>
            
            {/* Signer Key */}
            <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary">
              <Lock className="w-4 h-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground">
                {signerPublicKey.slice(0, 8)}...
              </span>
            </div>
            
            {/* Engine Status */}
            <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md ${
              isRunning ? 'bg-status-allow/10' : 'bg-status-block/10'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isRunning ? 'bg-status-allow animate-pulse' : 'bg-status-block'
              }`} />
              <span className={`text-sm font-medium ${
                isRunning ? 'text-status-allow' : 'text-status-block'
              }`}>
                {isRunning ? 'LIVE' : 'STOPPED'}
              </span>
            </div>
            
            {/* Wallet Button */}
            <WalletMultiButton />
          </div>
        </div>
      </div>
    </header>
  );
}
