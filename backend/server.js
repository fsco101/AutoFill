const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { runAutofill } = require("./runner");

require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: corsOrigin }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/run", upload.single("csv"), async (req, res) => {
  try {
    const configRaw = req.body?.config;
    if (!configRaw) {
      return res.status(400).json({ error: "Missing config" });
    }

    let config;
    try {
      config = JSON.parse(configRaw);
    } catch (err) {
      return res.status(400).json({ error: "Invalid config JSON" });
    }

    const csvBuffer = req.file?.buffer || null;
    const result = await runAutofill({ config, csvBuffer });

    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Run failed" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
