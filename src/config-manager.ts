import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "./types.js";
import type {
  InstagramBotConfig,
  InstagramBotHistory,
  ReelCategory,
  InstagramThread,
  ThreadReelHistory,
} from "./types.js";
import { log } from "./logger.js";

const CONFIG_FILE = path.join(PROJECT_ROOT, ".instagram-config.json");
const HISTORY_FILE = path.join(PROJECT_ROOT, ".instagram-history.json");

const DEFAULT_CONFIG: InstagramBotConfig = {
  credentials: null,
  cronExpression: "0 9,18 * * *",
  categories: [],
  threads: [],
};

// ── JSON read/write helpers ────────────────────────────────────────────────

function readConfig(): InstagramBotConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as InstagramBotConfig;
    }
  } catch (err) {
    log(`config-manager: failed to read config: ${err}`);
  }
  return { ...DEFAULT_CONFIG, categories: [], threads: [] };
}

function writeConfig(config: InstagramBotConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

function readHistory(): InstagramBotHistory {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as InstagramBotHistory;
    }
  } catch (err) {
    log(`config-manager: failed to read history: ${err}`);
  }
  return { threads: {} };
}

function writeHistory(history: InstagramBotHistory): void {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

// ── ConfigManager class ────────────────────────────────────────────────────
// Reads fresh from disk on every operation (no in-memory caching) to keep
// state consistent across cron runs and MCP tool calls.

class ConfigManager {
  // ── Credentials ──────────────────────────────────────────────────────────

  setCredentials(username: string, password: string): void {
    const config = readConfig();
    config.credentials = { username, password };
    writeConfig(config);
    log(`config-manager: credentials saved for @${username}`);
  }

  getCredentials(): { username: string; password: string } | null {
    return readConfig().credentials;
  }

  // ── Schedule ─────────────────────────────────────────────────────────────

  getCronExpression(): string {
    return readConfig().cronExpression;
  }

  setCronExpression(expr: string): void {
    const config = readConfig();
    config.cronExpression = expr;
    writeConfig(config);
    log(`config-manager: cron expression updated to: ${expr}`);
  }

  // ── Categories ───────────────────────────────────────────────────────────

  getCategories(): ReelCategory[] {
    return readConfig().categories;
  }

  upsertCategory(category: ReelCategory): void {
    const config = readConfig();
    const idx = config.categories.findIndex((c) => c.name === category.name);
    if (idx >= 0) {
      config.categories[idx] = category;
      log(`config-manager: category updated: ${category.name}`);
    } else {
      config.categories.push(category);
      log(`config-manager: category added: ${category.name}`);
    }
    writeConfig(config);
  }

  removeCategory(name: string): boolean {
    const config = readConfig();
    const idx = config.categories.findIndex((c) => c.name === name);
    if (idx < 0) return false;
    config.categories.splice(idx, 1);
    writeConfig(config);
    log(`config-manager: category removed: ${name}`);
    return true;
  }

  // ── Threads ───────────────────────────────────────────────────────────────

  getThreads(): InstagramThread[] {
    return readConfig().threads;
  }

  getThread(threadId: string): InstagramThread | null {
    return readConfig().threads.find((t) => t.threadId === threadId) ?? null;
  }

  upsertThread(thread: InstagramThread): void {
    const config = readConfig();
    const idx = config.threads.findIndex((t) => t.threadId === thread.threadId);
    if (idx >= 0) {
      config.threads[idx] = thread;
      log(`config-manager: thread updated: ${thread.threadId}`);
    } else {
      config.threads.push(thread);
      log(`config-manager: thread added: ${thread.threadId}`);
    }
    writeConfig(config);
  }

  removeThread(threadId: string): boolean {
    const config = readConfig();
    const idx = config.threads.findIndex((t) => t.threadId === threadId);
    if (idx < 0) return false;
    config.threads.splice(idx, 1);
    writeConfig(config);
    log(`config-manager: thread removed: ${threadId}`);
    return true;
  }

  getFullConfig(): InstagramBotConfig {
    return readConfig();
  }

  // ── History ───────────────────────────────────────────────────────────────

  getAllHistory(): InstagramBotHistory {
    return readHistory();
  }

  /** Get history for a thread. Resets dailyCount if date has changed (midnight auto-reset). */
  getOrResetDailyCount(threadId: string): ThreadReelHistory {
    const history = readHistory();
    const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"

    if (!history.threads[threadId]) {
      history.threads[threadId] = {
        threadId,
        sentReelUrls: [],
        dailyCount: 0,
        dailyCountDate: today,
        lastSentAt: null,
      };
    }

    const record = history.threads[threadId];
    if (record.dailyCountDate !== today) {
      record.dailyCount = 0;
      record.dailyCountDate = today;
      log(`config-manager: daily count reset for thread ${threadId} (new day: ${today})`);
    }

    writeHistory(history);
    return record;
  }

  getSentUrls(threadId: string): string[] {
    const history = readHistory();
    return history.threads[threadId]?.sentReelUrls ?? [];
  }

  /** Returns the union of every reel ever sent across ALL threads — global dedup pool. */
  getGlobalSentUrls(): Set<string> {
    const history = readHistory();
    const all = new Set<string>();
    for (const record of Object.values(history.threads)) {
      for (const url of record.sentReelUrls) all.add(url);
    }
    return all;
  }

  recordSentReel(threadId: string, reelUrl: string): void {
    const history = readHistory();
    const today = new Date().toISOString().split("T")[0];

    if (!history.threads[threadId]) {
      history.threads[threadId] = {
        threadId,
        sentReelUrls: [],
        dailyCount: 0,
        dailyCountDate: today,
        lastSentAt: null,
      };
    }

    const record = history.threads[threadId];

    // Add to lifetime dedup list
    if (!record.sentReelUrls.includes(reelUrl)) {
      record.sentReelUrls.push(reelUrl);
    }

    // Increment daily count (reset if date changed)
    if (record.dailyCountDate !== today) {
      record.dailyCount = 1;
      record.dailyCountDate = today;
    } else {
      record.dailyCount++;
    }

    record.lastSentAt = new Date().toISOString();
    writeHistory(history);
    log(`config-manager: recorded sent reel for ${threadId} (dailyCount=${record.dailyCount})`);
  }
}

export const configManager = new ConfigManager();
