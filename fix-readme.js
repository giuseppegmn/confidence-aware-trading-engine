const fs = require('fs');

const readme = \# CATE — Confidence-Aware Trading Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Devnet-purple)](https://solana.com)
[![Pyth Network](https://img.shields.io/badge/Oracle-Pyth%20Network-blue)](https://pyth.network)

> Production-grade risk-aware execution layer for DeFi trading.
> 
> *"Is this data statistically trustworthy enough to risk real capital?"*

CATE evaluates oracle data quality before trade execution. It consumes real-time price feeds from Pyth Network, calculates volatility and confidence metrics, cryptographically signs risk decisions, and provides on-chain verifiable attestations.

---

## Overview

\\\
React UI → CATE Context → Pyth Hermes API → Volatility Tracker → Risk Engine → Backend Signing → Signed Decision
\\\

## Features

**Multi-Asset Risk Intelligence**
- Supported: SOL/USD, BTC/USD, ETH/USD
- Real-time Pyth Network Hermes API
- 20-period rolling volatility
- Confidence ratio analysis

**Deterministic Risk Engine**

| Action | Risk Score | Size | Condition |
|--------|-----------|------|-----------|
| ALLOW | 0-40 | 100% | Low risk |
| SCALE | 40-80 | 50-90% | Elevated risk |
| BLOCK | 80+ | 0% | High risk |

Formula: \combinedScore = (confidence × 0.7) + (volatility × 0.3)\

**Cryptographic Attestation**
- Ed25519 signatures
- SHA-512 decision hashes
- Nonce replay protection
- Public key verification

**Fail-Closed Safety**
Defaults to BLOCK on: API failure, stale data (>60s), invalid signature, circuit breaker open.

---

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm

### Install
\\\ash
# Frontend
pnpm install

# Backend
cd api-server && pnpm install
\\\

### Configure
Create \.env\:
\\\env
VITE_API_URL=http://localhost:3001
VITE_PROGRAM_ID=77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_SOLANA_NETWORK=devnet
\\\

### Run

Terminal 1 — Backend:
\\\ash
cd api-server
pnpm start
# http://localhost:3001
\\\

Terminal 2 — Frontend:
\\\ash
pnpm dev
# http://localhost:5173
\\\

---

## API

### GET /health
\\\json
{
  "status": "ok",
  "publicKey": "9v93n8WHszhzqixoTwFm7VFRgViUGvXb4d1dcdXoBcLm"
}
\\\

### POST /api/v1/sign-decision
\\\json
{
  "assetId": "SOL/USD",
  "price": 117.66,
  "timestamp": 1706476800,
  "confidenceRatio": 8,
  "riskScore": 25,
  "isBlocked": false,
  "publisherCount": 5,
  "nonce": 123456
}
\\\

Response:
\\\json
{
  "success": true,
  "data": {
    "assetId": "SOL/USD",
    "riskScore": 25,
    "decisionHash": [32, 45, 67],
    "signature": [64, 12, 89],
    "signerBase58": "9v93n8WHszhzqixoTwFm7VFRgViUGvXb4d1dcdXoBcLm"
  }
}
\\\

---

## Risk Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| maxConfidenceRatioScale | 1.0% | Scale threshold |
| maxConfidenceRatioBlock | 3.0% | Block threshold |
| maxStalenessSeconds | 60 | Max data age |
| maxVolatilityScale | 2.0% | Volatility scale |
| maxVolatilityBlock | 5.0% | Volatility block |
| scaleMinMultiplier | 0.5 | Min position (50%) |
| scaleMaxMultiplier | 0.9 | Max position (90%) |

---

## Project Structure

\\\
├── api-server/          # Backend signing service
├── src/
│   ├── lib/
│   │   ├── CATEContext.tsx    # React context
│   │   ├── oracleReal.ts      # Pyth API
│   │   ├── riskIntelligence.ts # Risk engine
│   │   └── signing.ts         # API client
│   └── App.tsx           # Token selector UI
├── contracts/            # Solana program (optional)
└── .env
\\\

---

## On-Chain Integration

Program ID: \77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6\ (Devnet)

Instructions: \initialize_config\, \update_risk_status\, \erify_decision\, \get_risk_status\

---

## Testing

1. Start backend and frontend
2. Select asset (SOL/BTC/ETH)
3. Click "Simulate Risk Decision" 5+ times
4. Check volatility increases
5. Verify console logs: \[CATE]\, \[Oracle]\

---

## Security

- Private keys in backend only (port 3001)
- Deterministic outputs
- Fail-closed default
- API key authentication
- CORS restricted

---

## Limitations

- Assets: SOL, BTC, ETH only (JUP/BONK/PYTH disabled)
- On-chain publishing: not UI-integrated
- Volatility: requires 5+ samples
- Network: Devnet only

---

## Roadmap

**v0.2** (Current): Multi-asset, Pyth integration, Ed25519 signing, volatility tracking
**v0.3** (Planned): Jupiter DEX, on-chain publishing, mainnet
**v1.0** (Future): Governance, multi-oracle, MEV protection

---

## License

MIT

---

**Disclaimer**: Experimental software. Use at your own risk. Always audit before handling real funds.
\;

fs.writeFileSync('README.md', readme);
console.log('README created!');
