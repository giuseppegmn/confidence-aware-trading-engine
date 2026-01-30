# CATE Off-Chain Execution Model

## Architectural Positioning

CATE is designed as an **off-chain risk-intelligence engine**.

Its primary responsibility is to evaluate the **statistical reliability of oracle data**
*before* execution occurs.

CATE intentionally separates:
- Risk intelligence
- Execution logic
- Capital custody

---

## Why Off-Chain by Design

Oracle confidence analysis involves:
- Floating-point statistics
- Volatility windows
- Threshold calibration
- Deterministic but computation-heavy logic

Executing this logic fully on-chain would be:
- Costly
- Inflexible
- Unnecessarily restrictive

Off-chain execution allows:
- Faster iteration
- Richer statistical models
- Deterministic decision signing
- Optional on-chain verification

---

## What Runs Off-Chain

- Oracle ingestion (Pyth price feeds)
- Confidence interval analysis
- Volatility computation
- Risk scoring
- ALLOW / BLOCK decision generation
- Decision hashing and signing

---

## What Can Run On-Chain (Optional)

CATE supports optional on-chain components such as:
- Decision attestation
- Signature verification
- Execution gating hooks
- Auditability of risk decisions

On-chain components **do not execute trades**.
They only verify that a decision was produced by CATE.

---

## What CATE Will Never Do On-Chain

- Execute trades
- Hold user funds
- Act as a market maker
- Replace execution protocols

---

## Trust Model

CATE follows a **trust-minimized, not trustless** model.

Trust assumptions are explicit:
- The risk engine logic is open-source
- Decisions are deterministic
- Outputs are signed and verifiable
- Execution systems choose whether to enforce them

---

## Design Philosophy

In uncertain markets, the safest execution
is often **no execution at all**.

CATE enforces that discipline programmatically.
