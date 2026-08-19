const express = require("express");
const { extractFoodItemsFromText } = require("../services/extractText");
const { extractFoodItemsFromPhoto } = require("../services/extractPhoto");
const { withIdempotency } = require("../idempotency");
const { logEvent, newTraceId, withStageLogging } = require("../logger");

const router = express.Router();

router.post("/text", async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'text' string." });
  }

  const traceId = req.headers["x-trace-id"] || newTraceId();
  const idempotencyKey = req.headers["idempotency-key"] || null;

  try {
    const result = await withIdempotency(idempotencyKey, () =>
      withStageLogging(
        traceId,
        "llm_extract",
        () => extractFoodItemsFromText(text.trim()),
        { rawTextLength: text.length },
      ),
    );
    res.json(result);
  } catch (err) {
    logEvent({
      traceId,
      stage: "error",
      payload: { route: "/api/extract/text", message: String(err.message || err) },
    });
    res.status(502).json({ error: "Could not analyze that text right now. Please try again." });
  }
});

router.post("/photo", async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};
  if (typeof imageBase64 !== "string" || !imageBase64) {
    return res.status(400).json({ error: "Request body must include 'imageBase64'." });
  }

  const traceId = req.headers["x-trace-id"] || newTraceId();
  const idempotencyKey = req.headers["idempotency-key"] || null;

  try {
    const result = await withIdempotency(idempotencyKey, () =>
      withStageLogging(
        traceId,
        "vision_extract",
        () => extractFoodItemsFromPhoto(imageBase64, mimeType || "image/jpeg"),
        { imageSizeBytes: Math.round((imageBase64.length * 3) / 4) },
      ),
    );
    res.json(result);
  } catch (err) {
    logEvent({
      traceId,
      stage: "error",
      payload: { route: "/api/extract/photo", message: String(err.message || err) },
    });
    res.status(502).json({ error: "Could not analyze that photo right now. Please try again." });
  }
});

module.exports = router;
