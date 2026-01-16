import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient, ServerApiVersion } from "mongodb";

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB setup
app.use(cors());
// Required env vars (set these later in Render; for local you can export them)
const { MONGODB_URI } = process.env;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI env var");
}
 
// Reuse the client across requests (important on serverless / small instances)
const client = new MongoClient(MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let clientPromise;
async function getClient() {
  if (!clientPromise) {
    clientPromise = client.connect();
  }
  return clientPromise;
}
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/singleton", async (_req, res) => {
  try {
    const c = await getClient();
    const doc = await c
      .db("poc")
      .collection("singleton")
      .findOne({ _id: "singleton" });

    if (!doc) return res.status(404).json({ error: "Not found" });
    return res.json(doc);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});