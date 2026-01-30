import express from "express";
import cors from "cors";
import nacl from "tweetnacl";
import bs58 from "bs58";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// ⚠️ chave TEMPORÁRIA (dev only)
const SECRET_KEY = nacl.sign.keyPair();

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.post("/sign", (req, res) => {
  const { decision_hash } = req.body;

  if (!decision_hash) {
    return res.status(400).json({ error: "missing decision_hash" });
  }

  const message = bs58.decode(decision_hash);
  const signature = nacl.sign.detached(message, SECRET_KEY.secretKey);

  res.json({
    signer_pubkey: bs58.encode(SECRET_KEY.publicKey),
    signature: bs58.encode(signature),
  });
});

app.listen(PORT, () => {
  console.log(`CATE backend running on http://localhost:${PORT}`);
});
