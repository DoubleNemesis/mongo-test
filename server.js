import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb";

const clientCache = new Map(); // key: mongodbUri, value: Promise<MongoClient>
const MAX_CACHED_CLIENTS = 50;

function getClientForUri(mongodbUri) {
  if (!mongodbUri || typeof mongodbUri !== "string") {
    throw new Error("Missing mongodbUri");
  }

  // Minimal sanity check; avoid logging the URI anywhere.
  if (
    !mongodbUri.startsWith("mongodb+srv://") &&
    !mongodbUri.startsWith("mongodb://")
  ) {
    throw new Error("mongodbUri must start with mongodb+srv:// or mongodb://");
  }

  if (!clientCache.has(mongodbUri)) {
    if (clientCache.size >= MAX_CACHED_CLIENTS) {
      // delete oldest inserted item (Map keeps insertion order)
      const oldestKey = clientCache.keys().next().value;
      clientCache.delete(oldestKey);
    }
    const client = new MongoClient(mongodbUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    clientCache.set(
      mongodbUri,
      client.connect().then(() => client),
    );
  }

  return clientCache.get(mongodbUri);
}
// until here

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
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
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

app.post("/mongo/findOne", async (req, res) => {
  try {
    const { mongodbUri, db, collection, filter } = req.body || {};
    if (!mongodbUri || !db || !collection || !filter) {
      return res
        .status(400)
        .json({ error: "Missing mongodbUri, db, collection, or filter" });
    }

    const c = await getClientForUri(mongodbUri);
    const doc = await c.db(db).collection(collection).findOne(filter);

    return res.json({ doc });
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    const message = err?.message;

    // Example: duplicate key error (E11000) is very common in exercises
    if (code === 11000) {
      return res.status(409).json({ error: "Duplicate key", code, message });
    }

    return res.status(500).json({ error: "Server error", code, name, message });
  }
});

app.post("/mongo/insertOne", async (req, res) => {
  try {
    const { mongodbUri, db, collection, document } = req.body || {};
    if (!mongodbUri) {
      return res.status(400).json({ error: "Missing mongodbUri" });
    }
    if (!db || !collection || !document) {
      return res
        .status(400)
        .json({ error: "Missing db, collection, or document" });
    }

    const c = await getClientForUri(mongodbUri);

    const result = await c.db(db).collection(collection).insertOne(document);

    return res.json({
      insertedId: result.insertedId,
      acknowledged: result.acknowledged,
    });
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    const message = err?.message;

    // Example: duplicate key error (E11000) is very common in exercises
    if (code === 11000) {
      return res.status(409).json({ error: "Duplicate key", code, message });
    }

    return res.status(500).json({ error: "Server error", code, name, message });
  }
});

app.post("/mongo/updateOne", async (req, res) => {
  try {
    const { mongodbUri, db, collection, filter, update, options } =
      req.body || {};
    if (!mongodbUri)
      return res.status(400).json({ error: "Missing mongodbUri" });
    if (!db || !collection || !filter || !update) {
      return res
        .status(400)
        .json({ error: "Missing db, collection, filter, or update" });
    }

    const c = await getClientForUri(mongodbUri);
    const result = await c
      .db(db)
      .collection(collection)
      .updateOne(filter, update, options || undefined);

    return res.json({
      acknowledged: result.acknowledged,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedId: result.upsertedId ?? null,
    });
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    const message = err?.message;

    // Example: duplicate key error (E11000) is very common in exercises
    if (code === 11000) {
      return res.status(409).json({ error: "Duplicate key", code, message });
    }

    return res.status(500).json({ error: "Server error", code, name, message });
  }
});

app.post("/mongo/deleteOne", async (req, res) => {
  try {
    const { mongodbUri, db, collection, filter } = req.body || {};
    if (!mongodbUri)
      return res.status(400).json({ error: "Missing mongodbUri" });
    if (!db || !collection || !filter) {
      return res
        .status(400)
        .json({ error: "Missing db, collection, or filter" });
    }

    const c = await getClientForUri(mongodbUri);
    const result = await c.db(db).collection(collection).deleteOne(filter);

    return res.json({
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    const message = err?.message;

    // Example: duplicate key error (E11000) is very common in exercises
    if (code === 11000) {
      return res.status(409).json({ error: "Duplicate key", code, message });
    }

    return res.status(500).json({ error: "Server error", code, name, message });
  }
});

app.post("/mongo/find", async (req, res) => {
  try {
    const { mongodbUri, db, collection, filter, options } = req.body || {};
    if (!mongodbUri)
      return res.status(400).json({ error: "Missing mongodbUri" });
    if (!db || !collection) {
      return res.status(400).json({ error: "Missing db or collection" });
    }

    const c = await getClientForUri(mongodbUri);
    const cursor = c
      .db(db)
      .collection(collection)
      .find(filter || {}, options || undefined);

    // Apply cursor modifiers passed in options (keep it minimal)
    if (options?.sort) cursor.sort(options.sort);
    if (options?.limit) cursor.limit(options.limit);
    if (options?.project) cursor.project(options.project);

    const docs = await cursor.toArray();
    return res.json({ docs });
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    const message = err?.message;

    // Example: duplicate key error (E11000) is very common in exercises
    if (code === 11000) {
      return res.status(409).json({ error: "Duplicate key", code, message });
    }

    return res.status(500).json({ error: "Server error", code, name, message });
  }
});

app.post("/mongo/findOneAndUpdate", async (req, res) => {
  try {
    const { mongodbUri, db, collection, filter, update, options } =
      req.body || {};
    if (!mongodbUri)
      return res.status(400).json({ error: "Missing mongodbUri" });
    if (!db || !collection || !filter || !update) {
      return res
        .status(400)
        .json({ error: "Missing db, collection, filter, or update" });
    }

    const normalized = { ...(options || {}) };

    // Ensure we ALWAYS get a ModifyResult back with a `.value` field
    normalized.includeResultMetadata = true;

    // For newer option style, keep returnDocument; (no need to translate if driver supports it)
    // If you want maximum backward compatibility you can also translate:
    if (normalized.returnDocument === "after")
      normalized.returnOriginal = false;

    const c = await getClientForUri(mongodbUri);
    const result = await c
      .db(db)
      .collection(collection)
      .findOneAndUpdate(filter, update, normalized);

    return res.json({ value: result.value ?? null });
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    const message = err?.message;

    // Example: duplicate key error (E11000) is very common in exercises
    if (code === 11000) {
      return res.status(409).json({ error: "Duplicate key", code, message });
    }

    return res.status(500).json({ error: "Server error", code, name, message });
  }
});

app.post("/mongo/insertMany", async (req, res) => {
  try {
    const { mongodbUri, db, collection, documents, options } = req.body || {};
    if (!mongodbUri) return res.status(400).json({ error: "Missing mongodbUri" });
    if (!db || !collection || !Array.isArray(documents)) {
      return res.status(400).json({ error: "Missing db, collection, or documents[]" });
    }

    const c = await getClientForUri(mongodbUri);
    const result = await c.db(db).collection(collection).insertMany(documents, options);

    return res.json({
      acknowledged: result.acknowledged,
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", message: err?.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
