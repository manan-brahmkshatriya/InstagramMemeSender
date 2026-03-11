/**
 * daily-send-daemon.mjs
 *
 * Runs forever. Every 24-hour window it:
 *   1. Scrapes 3+ fresh URLs from the desi-healthy-veg-protein hashtags
 *   2. Picks 3 random send times spread across the next 24 hours
 *   3. Sends each reel to "Food and movies" at the scheduled time
 *   4. After the last send, immediately plans the next window
 *
 * Usage: node scripts/daily-send-daemon.mjs
 * Logs:  /tmp/food-movies-daemon.log  +  stderr
 */

import { appendFileSync } from "fs";
import { configManager } from "../dist/config-manager.js";
import { scrapeReelUrlsOnly } from "../dist/reel-scraper.js";
import { sendReelLinkToThread } from "../dist/reel-sender.js";
import { instagramBrowser } from "../dist/instagram-browser.js";

const THREAD_ID  = "food-and-movies";
const COUNT      = 3;
const WINDOW_MS  = 24 * 60 * 60 * 1000;
const LOG_FILE   = "/tmp/food-movies-daemon.log";
const HASHTAGS   = [
  "desihealthyfood",
  "vegetarianprotein",
  "indianvegetarianfood",
  "healthydesirecipes",
  "proteinrichvegetarian",
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

async function planWindow() {
  const thread = configManager.getThread(THREAD_ID);
  const windowStart = Date.now();

  log(`Planning next ${COUNT} sends — window starts ${new Date(windowStart).toLocaleString()}`);

  // ── Scrape URLs ────────────────────────────────────────────────────────────
  let urls = [];
  try {
    const alreadySent = configManager.getGlobalSentUrls(); // global dedup across all threads
    urls = await scrapeReelUrlsOnly(HASHTAGS, COUNT + 3, alreadySent);
    await instagramBrowser.close();
  } catch (err) {
    log(`ERROR scraping: ${err.message} — retrying in 15 min`);
    await instagramBrowser.close().catch(() => {});
    setTimeout(planWindow, 15 * 60 * 1000);
    return;
  }

  if (urls.length === 0) {
    log("No new URLs found — retrying in 1 hour");
    setTimeout(planWindow, 60 * 60 * 1000);
    return;
  }

  const sendUrls = urls.slice(0, Math.min(COUNT, urls.length));

  // ── Generate random send times within window ───────────────────────────────
  const delays = Array.from({ length: sendUrls.length }, () => Math.random() * WINDOW_MS);
  delays.sort((a, b) => a - b);

  log(`Will send ${sendUrls.length} reels:`);
  delays.forEach((d, i) => {
    const at = new Date(windowStart + d);
    log(`  ${i + 1}. ${at.toLocaleString()}  (+${(d / 60000).toFixed(1)} min)  ${sendUrls[i]}`);
  });

  // ── Schedule sends ─────────────────────────────────────────────────────────
  let completed = 0;
  sendUrls.forEach((url, i) => {
    setTimeout(async () => {
      log(`Sending ${i + 1}/${sendUrls.length}: ${url}`);
      try {
        const ok = await sendReelLinkToThread(thread.threadName, url);
        if (ok) {
          configManager.recordSentReel(THREAD_ID, url);
          log(`✓ sent ${i + 1}/${sendUrls.length}`);
        } else {
          log(`✗ failed ${i + 1}/${sendUrls.length}`);
        }
        await instagramBrowser.close();
      } catch (err) {
        log(`ERROR on send ${i + 1}: ${err.message}`);
        await instagramBrowser.close().catch(() => {});
      }

      completed++;
      if (completed === sendUrls.length) {
        // Plan next window immediately after last send
        const elapsed = Date.now() - windowStart;
        const nextDelay = Math.max(0, WINDOW_MS - elapsed);
        log(`Window complete. Next window in ${(nextDelay / 60000).toFixed(1)} min`);
        setTimeout(planWindow, nextDelay);
      }
    }, delays[i]);
  });
}

log("=== Food and movies daily reel daemon started ===");
planWindow();
