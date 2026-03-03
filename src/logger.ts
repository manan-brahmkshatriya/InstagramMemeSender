import { appendFileSync } from "fs";

const LOG_FILE = "/tmp/instagram-bot-debug.log";

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stderr.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore write errors
  }
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error ?? "");
  log(`ERROR: ${message} ${detail}`);
}
