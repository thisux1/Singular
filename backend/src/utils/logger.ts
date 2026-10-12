export function logInfo(event: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.log(`[INFO] ${event}`, payload);
    return;
  }
  console.log(`[INFO] ${event}`);
}

export function logWarn(event: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.warn(`[WARN] ${event}`, payload);
    return;
  }
  console.warn(`[WARN] ${event}`);
}

export function logError(event: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.error(`[ERROR] ${event}`, payload);
    return;
  }
  console.error(`[ERROR] ${event}`);
}
