import cron from "node-cron";
import { configManager } from "./config-manager.js";
import { runForAllThreads } from "./bot-runner.js";
import { cleanupOldTempFiles } from "./reel-downloader.js";
import { log, logError } from "./logger.js";

let mainTask: cron.ScheduledTask | null = null;
let cleanupTask: cron.ScheduledTask | null = null;
let isRunning = false; // prevents concurrent runs triggered by cron overlap

/** Start (or restart) the main cron task using the current config expression. */
function scheduleMainTask(expr: string): void {
  if (mainTask) {
    mainTask.stop();
    mainTask = null;
    log("scheduler: stopped previous main task");
  }

  if (!cron.validate(expr)) {
    log(`scheduler: invalid cron expression "${expr}" — scheduler not started`);
    return;
  }

  mainTask = cron.schedule(expr, async () => {
    if (isRunning) {
      log("scheduler: cron triggered but previous run still in progress — skipping");
      return;
    }
    isRunning = true;
    log("scheduler: cron triggered — starting run for all threads");
    try {
      const results = await runForAllThreads();
      const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
      log(
        `scheduler: cron run complete — totalSent=${totalSent}, totalErrors=${totalErrors}`
      );
    } catch (err) {
      logError("scheduler: runForAllThreads threw", err);
    } finally {
      isRunning = false;
    }
  });

  log(`scheduler: main task scheduled with expression: "${expr}"`);
}

/** Schedule nightly temp file cleanup at 3 AM. */
function scheduleCleanupTask(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }
  cleanupTask = cron.schedule("0 3 * * *", () => {
    log("scheduler: running nightly temp file cleanup");
    cleanupOldTempFiles();
  });
  log("scheduler: nightly cleanup task scheduled at 3 AM");
}

/** Start the scheduler using the cron expression from config. */
export function startScheduler(): void {
  const expr = configManager.getCronExpression();
  log(`scheduler: starting with expression: "${expr}"`);
  scheduleMainTask(expr);
  scheduleCleanupTask();
}

/**
 * Update the cron schedule. Validates before saving and restarts the task.
 * Returns false if the expression is invalid.
 */
export function updateSchedule(newExpr: string): boolean {
  if (!cron.validate(newExpr)) {
    log(`scheduler: invalid cron expression: "${newExpr}"`);
    return false;
  }
  configManager.setCronExpression(newExpr);
  scheduleMainTask(newExpr);
  return true;
}

/** Whether a scheduled run is currently in progress. */
export function isSchedulerRunning(): boolean {
  return isRunning;
}

/** The currently active cron expression (from config). */
export function getCurrentExpression(): string {
  return configManager.getCronExpression();
}
