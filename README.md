# CATE — Confidence-Aware Trading Engine

**CATE is not a trading bot.**

It is a **risk-aware execution layer** that converts **Pyth oracle signal quality** (price + confidence interval + freshness) into deterministic decisions:

- **ALLOW** execution
- **SCALE** position size
- **BLOCK** execution (fail-closed)

> "Pyth tells you the price. CATE tells you if that price is safe to use."

---

## What this is

- A deterministic risk engine (same inputs → same outputs)
- A cryptographic signing module (Ed25519) for all decisions
- A Solana **trust anchor** (Anchor program) that verifies signatures and stores per-asset risk status
- A dashboard for observability and debugging

## What this is not

- Not a price oracle (Pyth is the oracle)
- Not a prediction model
- Not an automated trading strategy

---

## Architecture

```text
Pyth Hermes (oracle)  --->  CATE Risk Engine  --->  Signed Decision
        |                         |                     |
        |                         |                     v
        |                         |             Solana Trust Layer
        |                         |             (verify + registry)
        v                         v
   Metrics/Windows           Execution Gate
   (freshness, zscore,       (ALLOW/SCALE/BLOCK)
    confidence ratio)
```

---

## One-command local demo

### 1) Install

```bash
pnpm install
```

### 2) Run UI

```bash
pnpm dev
```

### 3) Run node demo (oracle → decision → signature)

```bash
pnpm demo
```

This demo:
- pulls real data from Pyth Hermes
- runs the deterministic risk engine
- produces and verifies an Ed25519 signature
- prints a human-readable decision

> Note: On-chain publish requires a funded Solana keypair. See **On-chain demo** below.

---

## On-chain demo (devnet)

### Prereqs

- Solana CLI installed
- A devnet keypair funded with SOL

```bash
solana config set --url https://api.devnet.solana.com
solana airdrop 2
```

### Run

```bash
pnpm demo:onchain
```

Environment variables:

- `CATE_SOLANA_KEYPAIR` (optional): path to keypair json (defaults to `~/.config/solana/id.json`)
- `CATE_RPC_ENDPOINT` (optional): defaults to devnet
- `CATE_TRUSTED_SIGNER_SECRET` (optional): base58 secret key for the decision signer (otherwise generated per run)

---

## Threat model

Assume a hostile environment:

- Oracle staleness / outage
- Short-lived market dislocations
- Malicious users trying to bypass risk controls
- Attempted signature forgery / replay

**Fail-closed principle:** if data quality is uncertain, execution is blocked.

---

## Failure modes

- Hermes disconnected → **BLOCK**
- stale price feed → **BLOCK**
- confidence spikes / anomalies → **SCALE/BLOCK**
- signature invalid → **reject on-chain**

---

## Roadmap

- **v0.1 (current)**: deterministic risk engine + signed decisions + on-chain verification
- **v0.2**: real Jupiter devnet swaps with strict slippage and full balance checks
- **v1.0**: multi-oracle fusion, governance, institutional telemetry

---

## Development

### Tests

```bash
pnpm test
```

### Chaos mode (simulate failures)

```bash
pnpm chaos
```

---

## License

MIT (recommended for ecosystem adoption).
