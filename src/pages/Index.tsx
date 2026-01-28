/**
 * CATE - Main Dashboard
 * 
 * Confidence-Aware Trading Engine
 * Production-grade risk-aware execution layer
 * 
 * Architecture:
 * - Real Pyth Hermes oracle integration
 * - Ed25519 cryptographic decision signing
 * - Deterministic risk intelligence
 * - Circuit breaker fail-safes
 * - Jupiter swap integration
 * - On-chain trust layer with signature verification
 * - Full observability and audit logging
 */

import React from 'react';
import { CATEProvider } from '@/lib/CATEContext';
import { Header } from '@/components/Header';
import { MetricsPanel } from '@/components/MetricsPanel';
import { OracleFeedPanel } from '@/components/OracleFeedPanel';
import { RiskDecisionPanel } from '@/components/RiskDecisionPanel';
import { ExecutionLogPanel } from '@/components/ExecutionLogPanel';
import { ControlPanel } from '@/components/ControlPanel';
import { OnChainPanel } from '@/components/OnChainPanel';

function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Metrics Overview */}
        <MetricsPanel />
        
        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - Oracle Feeds */}
          <div className="lg:col-span-3">
            <OracleFeedPanel />
          </div>
          
          {/* Center Column - Risk Decision */}
          <div className="lg:col-span-5">
            <RiskDecisionPanel />
          </div>
          
          {/* Right Column - Controls & Execution */}
          <div className="lg:col-span-4 space-y-6">
            <ControlPanel />
            <OnChainPanel />
            <div className="h-[300px]">
              <ExecutionLogPanel />
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <footer className="text-center py-6 border-t border-border">
          <p className="text-xs text-muted-foreground">
            CATE - Confidence-Aware Trading Engine | Production-Grade Risk Intelligence
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            "Is this data statistically trustworthy enough to risk real capital?"
          </p>
          <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span>Pyth Hermes Oracle</span>
            <span>|</span>
            <span>Ed25519 Signed Decisions</span>
            <span>|</span>
            <span>On-Chain Verification</span>
            <span>|</span>
            <span>Jupiter Execution</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default function Index() {
  return (
    <CATEProvider>
      <Dashboard />
    </CATEProvider>
  );
}
