const MAX_EVENTS = 500;
let buffer = [];

function logEvent(event) {
  const full = { ...event, timestamp: new Date().toISOString() };
  buffer.push(full);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  // eslint-disable-next-line no-console
  console.log(
    `[${full.stage}] trace=${full.traceId}`,
    full.payload,
    full.durationMs ? `${full.durationMs}ms` : "",
  );
  return full;
}

function getRecentEvents(limit = 50) {
  return buffer.slice(-limit);
}

function newTraceId() {
  return `trc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function withStageLogging(traceId, stage, fn, extraPayload = {}) {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent({
      traceId,
      stage,
      durationMs: Date.now() - start,
      payload: { status: "ok", ...extraPayload },
    });
    return result;
  } catch (err) {
    logEvent({
      traceId,
      stage: "error",
      durationMs: Date.now() - start,
      payload: {
        status: "error",
        failedStage: stage,
        message: String(err && err.message ? err.message : err),
        ...extraPayload,
      },
    });
    throw err;
  }
}

module.exports = { logEvent, getRecentEvents, newTraceId, withStageLogging };
