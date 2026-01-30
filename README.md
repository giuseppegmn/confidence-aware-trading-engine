# CATE — Confidence-Aware Trading Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Devnet-purple)](https://solana.com)
[![Pyth Network](https://img.shields.io/badge/Oracle-Pyth%20Network-blue)](https://pyth.network)

> **Production-grade risk-aware execution layer for DeFi trading.**  
> *"Is this data statistically trustworthy enough to risk real capital?"*

CATE is a deterministic risk intelligence system that evaluates oracle data quality before allowing trade execution. It consumes real-time price feeds from Pyth Network, calculates volatility and confidence metrics, cryptographically signs risk decisions, and provides a signed attestation that can be verified on-chain.

---

## 🏗️ Architecture Overview
```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React UI      │────▶│  CATE Context    │────▶│  Pyth Hermes    │
│  (Port 5173)    │     │  (Risk Engine)   │     │  Oracle API     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                          │
         │                       ▼                          │
         │              ┌──────────────────┐               │
         │              │ Volatility       │               │
         └─────────────▶│ Tracker (20-period│◀──────────────┘
                        │ rolling window)  │
                        └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Risk Intelligence│
                        │ Engine           │
                        │                  │
                        │ • Confidence     │
                        │   Ratio Analysis │
                        │ • Volatility     │
                        │   Calculation    │
                        │ • Size Multiplier│
                        │   Determination  │
                        └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Backend Signing  │
                        │ API (Port 3001)  │
                        │                  │
                        │ Ed25519          │
                        │ Signature        │
                        └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Signed Decision  │
                        │ {action, score,  │
                        │ signature}       │
                        └──────────────────┘

---

## ✨ Core Features

### 1. Multi-Asset Risk Intelligence
- **Supported Assets**: SOL/USD, BTC/USD, ETH/USD  
- **Real-time Data**: Direct integration with Pyth Network Hermes API  
- **20-Period Volatility**: Rolling window standard deviation calculation  
- **Confidence Ratio**: Pyth oracle uncertainty quantification  

### 2. Deterministic Risk Engine

Three-tier decision system based on combined risk score (confidence × volatility):

| Action | Risk Score | Size Multiplier | Trigger Condition |
|--------|------------|-----------------|-------------------|
| **ALLOW** | 0–40 | 100% | Low confidence ratio + stable volatility |
| **SCALE** | 40–80 | 50–90% | Elevated risk factors, reduced position size |
| **BLOCK** | 80+ | 0% | High risk or invalid data, execution halted |

**Risk Formula:**
confidenceScore = (confidenceRatio / maxConfidenceRatioBlock) × 100  
volScore = (volatility / maxVolatilityBlock) × 100  
combinedScore = (confidenceScore × 0.7) + (volScore × 0.3)

### 3. Cryptographic Attestation
- **Ed25519 Signatures**: All decisions signed by backend authority  
- **Decision Hash**: SHA-512 hash of deterministic payload  
- **Replay Protection**: Nonce-based uniqueness verification  
- **Public Key Verification**: Signer identity exposed via /health endpoint  

### 4. Fail-Closed Safety
System defaults to BLOCK on any failure:
- Oracle API unavailable → BLOCK  
- Data staleness (>60s) → BLOCK  
- Invalid signature → BLOCK  
- Circuit breaker open → BLOCK  

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+  
- pnpm or npm  
- Git  

### 1. Clone Repository
git clone https://github.com/giuseppegmn/confidence-aware-trading-engine.git  
cd confidence-aware-trading-engine  

### 2. Install Dependencies
## Frontend  
pnpm install  

## Backend (signing API)  
cd api-server  
pnpm install  

### 3. Configure Environment

Create `.env` in project root:  
VITE_API_URL=http://localhost:3001  
VITE_PROGRAM_ID=77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6  
VITE_SOLANA_RPC=https://api.devnet.solana.com  
VITE_SOLANA_NETWORK=devnet  

### 4. Start Services

**Terminal 1 — Backend Signing API:**  
cd api-server  
pnpm start  
# Server running on http://localhost:3001  

**Terminal 2 — Frontend Application:**  
pnpm dev  
# Application running on http://localhost:5173  

### 5. Usage
1. Open http://localhost:5173  
2. Click **START** to initialize engine  
3. Select asset (SOL, BTC, or ETH)  
4. Click **SIMULATE RISK DECISION**  
5. Review risk metrics and signed decision  

---

## 📊 Risk Parameters

Default thresholds (configurable in `riskIntelligence.ts`):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxConfidenceRatioScale` | 1.0% | Confidence threshold for position scaling |
| `maxConfidenceRatioBlock` | 3.0% | Confidence threshold for blocking trades |
| `maxStalenessSeconds` | 60 | Maximum acceptable data age |
| `maxVolatilityScale` | 2.0% | Volatility threshold for scaling |
| `maxVolatilityBlock` | 5.0% | Volatility threshold for blocking |
| `scaleMinMultiplier` | 0.5 | Minimum position size (50%) |
| `scaleMaxMultiplier` | 0.9 | Maximum scaled position (90%) |

---

## 🔐 Backend API Specification

### Health Check
GET /health  

Response:  
{
  "status": "ok",
  "publicKey": "9v93n8WHszhzqixoTwFm7VFRgViUGvXb4d1dcdXoBcLm",
  "timestamp": 1706476800000
}

### Sign Decision
POST /api/v1/sign-decision  
Content-Type: application/json  
X-API-Key: your-api-key  

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

Response:  
{
  "success": true,
  "data": {
    "assetId": "SOL/USD",
    "riskScore": 25,
    "isBlocked": false,
    "confidenceRatio": 8,
    "publisherCount": 5,
    "timestamp": 1706476800,
    "decisionHash": [/* 32 bytes */],
    "signature": [/* 64 bytes */],
    "signerPublicKey": [/* 32 bytes */],
    "signerBase58": "9v93n8WHszhzqixoTwFm7VFRgViUGvXb4d1dcdXoBcLm"
  }
}

---

## 🏛️ On-Chain Integration (Optional)

CATE includes a Solana program for on-chain verification of signed decisions.

**Program ID:** 77kRa7xJb2SQpPC1fdFGj8edzm5MJxhq2j54BxMWtPe6 (Devnet)

**Instructions:**
- `initialize_config` — Set trusted signer authority  
- `update_risk_status` — Publish signed decision on-chain  
- `verify_decision` — Verify Ed25519 signature on-chain  
- `get_risk_status` — Query current risk state for asset  

*Note: On-chain publishing is implemented but not active in current UI flow.*

---

## 🧪 Testing

### Manual Testing
1. Start backend and frontend  
2. Select different assets (SOL/BTC/ETH)  
3. Click decision button 5+ times to build volatility history  
4. Verify volatility increases with price variance  
5. Check browser console for [CATE] and [Oracle] logs  

### Expected Behavior
- **Initial calls**: Volatility = 0% (insufficient history)  
- **After 5+ calls**: Volatility calculated from 20-period rolling window  
- **Price stability**: Low volatility, ALLOW decisions  
- **Price variance**: Higher volatility, potential SCALE decisions  

---

## 🛡️ Security Considerations

1. **Private Key Storage**: Signing key resides only in backend (port 3001), never exposed to frontend  
2. **Deterministic Outputs**: Same oracle data always produces identical risk scores  
3. **Fail-Closed**: Any system failure defaults to BLOCK action  
4. **API Authentication**: Backend endpoints require X-API-Key header  
5. **CORS Restricted**: Frontend only accepts connections from configured origins  

---

## 📁 Project Structure

confidence-aware-trading-engine/  
├── api-server/  
│   ├── index.ts  
│   └── package.json  
├── src/  
│   ├── lib/  
│   │   ├── CATEContext.tsx  
│   │   ├── oracleReal.ts  
│   │   ├── riskIntelligence.ts  
│   │   └── signing.ts  
│   ├── components/  
│   ├── App.tsx  
│   └── main.tsx  
├── contracts/  
├── .env  
└── package.json  

---

## 🚧 Known Limitations

- **Asset Coverage**: Currently limited to SOL, BTC, ETH (JUP, BONK, PYTH feeds disabled due to API inconsistencies)  
- **On-Chain Publishing**: Implemented but not integrated in UI flow  
- **Volatility Calculation**: Requires 5+ price samples for non-zero volatility  
- **Network**: Devnet only (mainnet integration requires additional configuration)  

---

## 🔮 Roadmap

### v0.2 (Current)
- ✅ Multi-asset support (SOL, BTC, ETH)  
- ✅ Real-time Pyth oracle integration  
- ✅ Ed25519 cryptographic signing  
- ✅ Volatility tracking with rolling windows  
- ✅ Circuit breaker pattern  

### v0.3 (Planned)
- Jupiter DEX execution integration  
- On-chain decision publishing  
- Mainnet deployment  
- Additional assets (LINK, AVAX, etc.)  

### v1.0 (Future)
- Governance parameter adjustment  
- Multi-oracle aggregation (Pyth + Chainlink)  
- MEV protection  
- Institutional custody integration  

---

## 🤝 Contributing

Contributions welcome. Please open an issue to discuss proposed changes before submitting PRs.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

- [Pyth Network](https://pyth.network) for high-fidelity oracle data  
- [Solana Foundation](https://solana.com) for blockchain infrastructure  
- [Anchor Framework](https://anchor-lang.com) for on-chain program development  

---

**Disclaimer**: CATE is experimental software. Use at your own risk. Always audit code before handling real funds.


