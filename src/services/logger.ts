import { PipelineLogEvent } from "../types";

const MAX_EVENTS = 500;
let buffer: PipelineLogEvent[] = [];

export function logEvent(event: Omit<PipelineLogEvent, "timestamp">): void {
  const full: PipelineLogEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  buffer.push(full);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  // eslint-disable-next-line no-console
  console.log(
    `[${full.stage}] trace=${full.traceId}`,
    full.payload,
    full.durationMs ? `${full.durationMs}ms` : "",
  );
}

export function getTrace(traceId: string): PipelineLogEvent[] {
  return buffer.filter((e) => e.traceId === traceId);
}

export function getAllEvents(): PipelineLogEvent[] {
  return buffer;
}

export function newTraceId(): string {
  return `trc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function withStageLogging<T>(
  traceId: string,
  stage: PipelineLogEvent["stage"],
  fn: () => Promise<T>,
  extraPayload: Record<string, unknown> = {},
): Promise<T> {
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
        message: String(err),
        ...extraPayload,
      },
    });
    throw err;
  }
}
