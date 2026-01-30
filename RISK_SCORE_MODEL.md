# CATE Risk Score Model

## Core Principle

Oracle prices are incomplete without their uncertainty.

CATE treats the confidence interval as the primary signal
for determining whether a trade is statistically safe.

---

## Risk Score Definition

CATE computes a deterministic risk score from **0 to 100**.

- 0   → statistically safe
- 100 → statistically unsafe

The score is derived from:
- Relative confidence interval width
- Short-term volatility

---

## Normalization Logic

Inputs are normalized to avoid:
- Extreme spikes
- False precision
- Non-deterministic behavior

The model favors simplicity, determinism, and explainability.

---

## Decision Thresholds

- riskScore <= 30 → ALLOW
- riskScore >= 70 → BLOCK
- otherwise       → CAUTION ZONE

Thresholds are intentionally conservative.

---

## Design Goal

The goal is not to predict profit.

The goal is to prevent execution
when the data itself is unreliable.
