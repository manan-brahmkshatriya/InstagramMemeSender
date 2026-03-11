/**
 * today-replacement-send.mjs
 * One-shot: sends today's 3 reels at the original scheduled times,
 * with URL #3 replaced by the user's chosen reel.
 * Re-enables the daily daemon after the last send.
 */

import { appendFileSync } from "fs";
import { execSync } from "child_process";
import { configManager } from "../dist/config-manager.js";
import { sendReelLinkToThread } from "../dist/reel-sender.js";
import { instagramBrowser } from "../dist/instagram-browser.js";

const LOG = "/tmp/food-movies-daemon.log";
function log(m) {
  const line = `[${new Date().toISOString()}] ${m}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG, line); } catch {}
}

const THREAD_ID    = "food-and-movies";
const WINDOW_START = new Date("2026-03-03T08:38:16.253Z").getTime();

// Original time slots — #3 swapped to user's URL
const sends = [
  { delay: 620.7 * 60 * 1000, url: "https://www.instagram.com/p/C8cODXWx1Ij/" },
  { delay: 892.2 * 60 * 1000, url: "https://www.instagram.com/p/DU9xuWTj5wV/" },
  { delay: 1306.6 * 60 * 1000, url: "https://www.instagram.com/p/DOLAA6rE5NV/" },
];

const thread = configManager.getThread(THREAD_ID);
const now = Date.now();

log("=== Today replacement sends (URL #3 swapped) ===");
sends.forEach((s, i) => {
  const target = WINDOW_START + s.delay;
  const remaining = Math.max(0, target - now);
  log(`  ${i + 1}. ${new Date(target).toLocaleString()}  (in ${(remaining / 60000).toFixed(1)} min)  ${s.url}`);
});

let completed = 0;
sends.forEach((s, i) => {
  const remaining = Math.max(0, WINDOW_START + s.delay - now);

  setTimeout(async () => {
    log(`Sending ${i + 1}/3: ${s.url}`);
    try {
      const ok = await sendReelLinkToThread(thread.threadName, s.url);
      if (ok) {
        configManager.recordSentReel(THREAD_ID, s.url);
        log(`✓ sent ${i + 1}/3`);
      } else {
        log(`✗ failed ${i + 1}/3`);
      }
      await instagramBrowser.close();
    } catch (err) {
      log(`ERROR send ${i + 1}: ${err.message}`);
      await instagramBrowser.close().catch(() => {});
    }

    completed++;
    if (completed === 3) {
      log("All 3 done. Re-enabling daily daemon for next cycle...");
      try {
        execSync("launchctl load /Users/mananbrahmkshatriya/Library/LaunchAgents/com.instagrambot.food-movies.plist");
        log("Daemon re-enabled — next 24h window will start after last send.");
      } catch (e) {
        log("Failed to re-enable daemon: " + e.message);
      }
      process.exit(0);
    }
  }, remaining);
});
