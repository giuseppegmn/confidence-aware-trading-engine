# CATE — Confidence-Aware Trading Engine

Risk-aware execution layer using Pyth confidence intervals to block or scale trades based on data quality.

---

## What this is

CATE is a **risk-aware execution engine** for DeFi systems.

Instead of blindly trusting oracle prices, CATE evaluates the **statistical quality** of oracle data before allowing any financial action.

It uses:
- Pyth price feeds
- Pyth confidence intervals
- deterministic risk rules
- cryptographic signing
- on-chain verification

to answer one fundamental question:

> *Is this price reliable enough to risk real capital?*

---

## What this is NOT

This project is NOT:

- a trading bot  
- a price prediction model  
- a yield optimizer  
- a machine learning black box  
- a price oracle replacement  

CATE does not try to predict markets.  
CATE only decides **whether a trade should be executed or blocked** based on data reliability.

---

## Core concept

Traditional DeFi systems treat oracle data as:

> price = truth

CATE treats oracle data as:

> price = hypothesis  
> confidence = signal quality

All decisions are made using **price + confidence interval**, not price alone.

---

## Architecture

