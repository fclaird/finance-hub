import { logError, logLine } from "@/lib/log";

type SchedulerState = {
  started: boolean;
  intervalId: NodeJS.Timeout | null;
  lastRunAt: number | null;
};

declare global {
  var __fhScheduler: SchedulerState | undefined;
}

function state(): SchedulerState {
  if (!globalThis.__fhScheduler) {
    globalThis.__fhScheduler = { started: false, intervalId: null, lastRunAt: null };
  }
  return globalThis.__fhScheduler;
}

export function startSchedulerOnce() {
  const s = state();
  if (s.started) return;

  // Skip during production build/static generation phases.
  const phase = process.env.NEXT_PHASE ?? "";
  if (phase.toLowerCase().includes("build")) return;

  s.started = true;
  logLine("scheduler_start");

  const HOUR_MS = 60 * 60 * 1000;
  const jitterMs = () => Math.floor(Math.random() * 30_000);

  async function tick() {
    try {
      s.lastRunAt = Date.now();
      // Call internal API route so all logic stays in one place.
      await fetch("https://127.0.0.1:3000/api/schwab/sync", { method: "POST" });
      logLine("scheduler_schwab_sync_ok");
    } catch (e) {
      logError("scheduler_schwab_sync_failed", e);
    }
  }

  // Kick once shortly after boot, then hourly.
  setTimeout(() => void tick(), 10_000 + jitterMs());
  s.intervalId = setInterval(() => void tick(), HOUR_MS + jitterMs());
}

