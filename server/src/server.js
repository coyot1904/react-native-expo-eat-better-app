require("dotenv").config();
const express = require("express");
const cors = require("cors");
const extractRouter = require("./routes/extract");
const { getRecentEvents } = require("./logger");

const app = express();

// Photos come in as base64 JSON, so the default 100kb body limit isn't enough.
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

// Simple observability window into the in-memory log buffer — handy for
// demoing the pipeline live. In-memory means it resets on every restart
// (e.g. Render free tier cold-starting after inactivity); a real deployment
// would ship these events to a proper log/metrics backend instead.
app.get("/debug/logs", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json({ events: getRecentEvents(limit) });
});

app.use("/api/extract", extractRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EatBetter case-study server listening on port ${PORT}`);
});
