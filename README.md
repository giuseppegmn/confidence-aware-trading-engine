CATE — Confidence-Aware Trading Engine

Production-grade risk-aware execution layer for DeFi trading.
"Is this data statistically trustworthy enough to risk real capital?"

CATE is a deterministic risk intelligence system that evaluates oracle data quality before allowing trade execution. It consumes real-time price feeds (e.g., Pyth), calculates volatility and confidence metrics, cryptographically signs risk decisions, and provides a signed attestation that can be verified on-chain.

============================================================

WHAT CATE DOES

- Ingests oracle price and confidence data
- Computes confidence-aware risk signals (volatility, deviation, reliability)
- Produces deterministic allow/deny decisions for execution
- Emits and verifies on-chain attestations

============================================================

REPO LAYOUT

contracts/   -> Anchor (Solana) program  
frontend/    -> UI / dashboards (if present)  
services/    -> off-chain ingestion / analytics (if present)

============================================================

REQUIREMENTS (WINDOWS)

- WSL (Ubuntu)
- Rust toolchain
- Solana CLI
- Anchor

Docs:
Solana CLI: https://solana.com/docs/intro/installation  
Anchor: https://www.anchor-lang.com/docs/installation  

============================================================

BUILD & TEST

Run from inside contracts/ :

cd contracts
anchor build
anchor test

============================================================

DEVNET DEPLOYMENT

Cluster: Solana Devnet  
Program ID: 2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3  
IDL Account: fUTSexSZnRR5x7sJWHPyvHKX1bHMuUmjr6xEDMzpvJR  

Explorer Program:
https://explorer.solana.com/address/2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3?cluster=devnet

Explorer IDL:
https://explorer.solana.com/address/fUTSexSZnRR5x7sJWHPyvHKX1bHMuUmjr6xEDMzpvJR?cluster=devnet

============================================================

VERIFY (CLI)

solana config set --url https://api.devnet.solana.com  
solana program show 2CVGjnZ2BRebSeDHdo3VZknm5jVjxZmWu9m95M14sTN3  
solana account fUTSexSZnRR5x7sJWHPyvHKX1bHMuUmjr6xEDMzpvJR  

============================================================

RPC SETUP (RECOMMENDED)

Public devnet RPC endpoints are unstable and may return 403 or rate-limit.

Use a dedicated RPC provider such as:
- Helius
- QuickNode
- Alchemy
- Ankr

Example (PowerShell):

 = https://devnet.helius-rpc.com/?api-key=YOUR_KEY  
solana config set --url %SOLANA_RPC_URL%  
anchor deploy --provider.cluster %SOLANA_RPC_URL%  

============================================================

ENGINEERING NOTES

- Anchor.toml, declare_id(), and keypair must always match.
- Program ID and IDL account are deterministic and reproducible.
- If you cannot reproduce a deploy from scratch, the project is not production-grade.
- RPC instability is infrastructure, not a code problem.

============================================================

LICENSE

MIT

============================================================

PACKAGE MANAGER

This project intentionally uses pnpm.

Reason:
- npm (v10+) is known to fail on this codebase due to upstream bugs
- pnpm handles dependency resolution correctly for this repository

REQUIRED:
- pnpm >= 8.x

DO NOT USE:
- npm install
- npm ci

If you encounter install errors using npm, this is expected behavior.
Switch to pnpm.

Install pnpm:
npm install -g pnpm

Then run:
pnpm install

============================================================

