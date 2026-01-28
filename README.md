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

```ts
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
