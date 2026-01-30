# CATE — Confidence-Aware Trading Engine

## What CATE Is

CATE is a **risk-intelligence layer** for DeFi execution.

It does **not** execute trades.
It decides **whether a trade should be allowed to exist** based on the statistical quality of oracle data.

CATE evaluates real-time oracle feeds (Pyth Network), analyzes confidence intervals and volatility, and produces a **deterministic ALLOW / BLOCK decision** before any capital is put at risk.

---

## What CATE Is NOT

- ❌ Not a trading bot  
- ❌ Not an AMM  
- ❌ Not an oracle  
- ❌ Not a yield optimizer  

CATE does **not** chase yield.  
CATE exists to **prevent bad trades caused by unreliable price data**.

---

## The Core Problem

In DeFi, most protocols treat oracle prices as truth.

However, oracle prices come with **uncertainty**:
- Confidence intervals
- Volatility spikes
- Data dispersion

Ignoring this uncertainty leads to:
- Bad executions
- Unnecessary liquidations
- MEV amplification
- Capital loss

Most systems ask:
> *“What is the price?”*

CATE asks:
> **“Is this price statistically trustworthy enough to risk capital?”**

---

## How CATE Works (High-Level)

1. Consume real-time price feeds from Pyth Network
2. Extract confidence interval and volatility signals
3. Compute a deterministic risk decision
4. Output a signed decision: **ALLOW or BLOCK**

Execution systems can then decide whether to proceed.

---

## Execution Model

CATE currently operates as an **off-chain execution gate**.

Decisions can be:
- Logged
- Signed
- Attested
- Verified on-chain (optional)

CATE intentionally separates **risk intelligence** from **execution logic**.

---

## Why This Matters

In volatile or low-liquidity markets, the most profitable action is often:
> **Not trading at all**

CATE enforces that discipline programmatically.

---

## Project Status

This repository represents a **functional prototype** designed for:
- Hackathons
- Research
- Infrastructure experimentation
- Oracle-aware execution systems

Production hardening and economic integration are future steps.

---

## License

MIT
