# CATE — Confidence-Aware Trading Engine

Risk-aware execution layer using Pyth confidence intervals to block or scale trades based on data quality.

---

## What is CATE?

CATE is a system that decides whether a trade should be executed or blocked based on the quality of oracle data.

Instead of trusting prices blindly, CATE evaluates how reliable the data is before allowing any financial action.

---

## What CATE does

- Reads real-time price feeds from Pyth Network  
- Uses Pyth confidence intervals to measure uncertainty  
- Applies deterministic risk rules  
- Generates a signed decision  
- Verifies the decision on-chain  
- Allows, scales, or blocks execution  

---

## What CATE is not

CATE is not:

- A trading bot  
- A price prediction model  
- A yield strategy  
- A portfolio manager  
- An AI black box  

CATE does not try to predict markets.  
CATE only evaluates if the data is safe enough to act on.

---

## How it works

1. Oracle data is fetched from Pyth  
2. Risk is calculated using price + confidence  
3. A decision is generated  
4. The decision is cryptographically signed  
5. The decision is verified on-chain  
6. Execution is allowed or blocked  

---

## Decision format

Each decision has the following structure:

```
{
  asset_id: string,
  price: number,
  confidence: number,
  risk_score: number,
  action: "ALLOW" | "SCALE" | "BLOCK",
  explanation: string,
  timestamp: number,
  signature: string
}
```

---

## Quickstart

### Requirements
- Node.js 18+  
- pnpm  

### Install dependencies

```
pnpm install
```

### Run demo

```
pnpm demo
```

### Expected output

```
[ORACLE] BTC price: 43125.12
[ORACLE] Confidence: 0.42%

[RISK] risk_score: 18
[RISK] action: ALLOW
[RISK] explanation: Data within acceptable confidence threshold

[CHAIN] decision signed
[CHAIN] signature verified on-chain

[EXECUTION] trade allowed
```

---

## Failure behavior

If anything is wrong, the system blocks execution.

Examples:
- Oracle unavailable  
- Data too old  
- Confidence too high  
- Invalid signature  

CATE always fails closed.

---

## On-chain component

The on-chain program only:
- Verifies signatures  
- Stores risk state  
- Exposes get_risk_status(asset_id)  

It does not:
- Fetch oracle data  
- Calculate risk  
- Contain business logic  

---

## Roadmap

### v0.1
- Real oracle integration  
- Risk engine  
- Cryptographic signing  
- On-chain verification  

### v0.2
- Real execution integration  
- External protocol usage  

### v1.0
- Governance  
- Multi-oracle support  

---

## License

MIT
