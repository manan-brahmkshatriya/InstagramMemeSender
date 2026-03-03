import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── Config interfaces ──────────────────────────────────────────────────────

export interface ReelCategory {
  name: string;        // unique slug e.g. "veg-protein"
  hashtags: string[];  // ["vegetarianprotein", "indianfood"]
  description?: string;
}

export interface InstagramThread {
  threadId: string;     // user-defined slug e.g. "family-group" (stable key)
  threadName: string;   // display name to match in DM inbox
  categories: string[]; // subscribed category names
  dailyLimit: number;
  enabled: boolean;
}

export interface InstagramBotConfig {
  credentials: { username: string; password: string } | null;
  cronExpression: string;
  categories: ReelCategory[];
  threads: InstagramThread[];
}

// ── History interfaces ─────────────────────────────────────────────────────

export interface ThreadReelHistory {
  threadId: string;
  sentReelUrls: string[];  // lifetime dedup list (canonical reel URLs)
  dailyCount: number;
  dailyCountDate: string;  // "YYYY-MM-DD" — reset dailyCount when date changes
  lastSentAt: string | null;
}

export interface InstagramBotHistory {
  threads: Record<string, ThreadReelHistory>; // keyed by threadId
}

// ── Scraper / downloader interfaces ───────────────────────────────────────

export interface ScrapedReel {
  reelUrl: string;    // canonical: https://www.instagram.com/reel/XXXXX/
  videoSrc: string;   // CDN URL (expires quickly — download immediately)
  caption?: string;
  hashtag: string;
}

export interface DownloadedReel {
  tmpFilePath: string; // absolute path to .mp4 in /tmp/instagram-reels/
  fileSize: number;
  caption: string;
  reelUrl: string;     // original canonical URL for dedup recording
}

export interface SendResult {
  threadId: string;
  sent: number;
  skipped: number;
  errors: string[];
}

// ── MCP Tool result helpers ────────────────────────────────────────────────

export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function successResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: true, message }) }],
    isError: true,
  };
}
