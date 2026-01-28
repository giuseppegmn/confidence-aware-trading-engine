/**
 * CATE - On-Chain Trust Layer Panel
 * 
 * Shows on-chain risk status with:
 * - Signature verification
 * - Config initialization
 * - Decision publishing
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Upload, RefreshCw, CheckCircle, XCircle, AlertCircle, ExternalLink, Wallet, Lock, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCATE, useSelectedAsset } from '@/lib/CATEContext';
import { onChainTrustService, PROGRAM_ID } from '@/lib/chain/onChainTrust';

export function OnChainPanel() {
  const wallet = useWallet();
  const { 
    decisions, 
    signerPublicKey, 
    isChainInitialized, 
    initializeOnChain, 
    publishToChain 
  } = useCATE();
  const { assetId, decision } = useSelectedAsset();
  
  const [onChainStatus, setOnChainStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch on-chain status for selected asset
  const refreshOnChainStatus = useCallback(async () => {
    if (!wallet.publicKey) return;
    const status = await onChainTrustService.getRiskStatus(assetId);
    setOnChainStatus(status);
  }, [wallet.publicKey, assetId]);
  
  useEffect(() => {
    if (wallet.publicKey) {
      refreshOnChainStatus();
    }
  }, [refreshOnChainStatus, wallet.publicKey]);
  
  // Initialize config
  const handleInitialize = async () => {
    setIsLoading(true);
    setError(null);
    
    const result = await initializeOnChain();
    
    if (result.success) {
      setLastTx(result.txSignature || null);
    } else {
      setError(result.error || 'Failed to initialize');
    }
    
    setIsLoading(false);
  };
  
  // Publish risk status to chain
  const handlePublish = async () => {
    if (!decision) return;
    
    setIsLoading(true);
    setError(null);
    
    const result = await publishToChain(assetId);
    
    if (result.success) {
      setLastTx(result.txSignature || null);
      await refreshOnChainStatus();
    } else {
      setError(result.error || 'Failed to publish');
    }
    
    setIsLoading(false);
  };
  
  // Not connected state
  if (!wallet.publicKey) {
    return (
      <Card className="card-glow border-border">
        <CardHeader className="border-b border-border py-3 px-4">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            On-Chain Trust Layer
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Wallet className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-1">
              Connect wallet to interact with on-chain program
            </p>
            <p className="text-xs text-muted-foreground">
              Program: {PROGRAM_ID.slice(0, 8)}...{PROGRAM_ID.slice(-4)}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="card-glow border-border">
      <CardHeader className="border-b border-border py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            On-Chain Trust Layer
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Devnet
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 space-y-4">
        {/* Program Info */}
        <div className="p-3 rounded-md bg-secondary/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Program ID</span>
            <a
              href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <span className="font-mono">{PROGRAM_ID.slice(0, 8)}...</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Config Status</span>
            <span className={`text-xs font-medium ${isChainInitialized ? 'text-status-allow' : 'text-status-scale'}`}>
              {isChainInitialized ? 'Initialized' : 'Not Initialized'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Trusted Signer</span>
            <span className="text-xs font-mono text-muted-foreground">
              {signerPublicKey.slice(0, 12)}...
            </span>
          </div>
        </div>
        
        {/* Initialize Button */}
        {!isChainInitialized && (
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={handleInitialize}
            disabled={isLoading}
          >
            {isLoading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Shield className="w-4 h-4 mr-2" />
            )}
            Initialize Config
          </Button>
        )}
        
        {isChainInitialized && (
          <>
            <Separator />
            
            {/* Current Asset Status */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Selected Asset</span>
                <Badge variant="outline" className="text-xs">{assetId}</Badge>
              </div>
              
              {/* Off-chain vs On-chain Comparison */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-secondary/50">
                  <span className="text-muted-foreground block mb-1">Off-Chain</span>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Risk</span>
                      <span className="font-mono">{decision?.riskScore.toFixed(0) || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Status</span>
                      <span className={
                        decision?.action === 'ALLOW' ? 'text-status-allow' :
                        decision?.action === 'SCALE' ? 'text-status-scale' :
                        'text-status-block'
                      }>
                        {decision?.action || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Signed</span>
                      <span className="text-status-allow flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Yes
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="p-2 rounded bg-secondary/50">
                  <span className="text-muted-foreground block mb-1">On-Chain</span>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Risk</span>
                      <span className="font-mono">{onChainStatus?.riskScore ?? '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Blocked</span>
                      <span className={onChainStatus?.isBlocked ? 'text-status-block' : 'text-status-allow'}>
                        {onChainStatus ? (onChainStatus.isBlocked ? 'Yes' : 'No') : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Verified</span>
                      <span className={onChainStatus ? 'text-status-allow' : 'text-muted-foreground'}>
                        {onChainStatus ? 'Yes' : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* On-chain signature info */}
              {onChainStatus && (
                <div className="mt-2 p-2 rounded bg-secondary/50">
                  <div className="flex items-center gap-1 text-xs text-status-allow mb-1">
                    <Lock className="w-3 h-3" />
                    <span>Signature Verified On-Chain</span>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">
                    Hash: {onChainStatus.decisionHash.slice(0, 16)}...
                  </p>
                </div>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={handlePublish}
                disabled={isLoading || !decision}
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Publish Signed Decision
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={refreshOnChainStatus}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            
            {/* Last Transaction */}
            {lastTx && (
              <div className="p-2 rounded bg-status-allow/10 border border-status-allow/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-status-allow">Transaction Confirmed</span>
                  <a
                    href={`https://explorer.solana.com/tx/${lastTx}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <span className="font-mono">{lastTx.slice(0, 8)}...</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
            
            {/* Error Display */}
            {error && (
              <div className="p-2 rounded bg-status-block/10 border border-status-block/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-status-block flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-status-block">{error}</span>
                </div>
              </div>
            )}
          </>
        )}
        
        {/* Info Footer */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            DeFi protocols can query: <code className="bg-secondary px-1 rounded">get_risk_status(asset_id)</code>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Ed25519 signatures verified on-chain
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
