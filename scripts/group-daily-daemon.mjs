/**
 * group-daily-daemon.mjs
 *
 * Generic daily reel daemon. Every 24-hour window it:
 *   1. Scrapes COUNT fresh URLs from the given hashtags (global dedup)
 *   2. Picks COUNT random send times spread across the window
 *   3. Sends each reel to the configured thread at the scheduled time
 *   4. After the last send, immediately plans the next window
 *
 * Usage: node scripts/group-daily-daemon.mjs <threadId> <count> <hashtag,...>
 * Example: node scripts/group-daily-daemon.mjs bhaiyo-ki-gaand-masti 3 funny,funnyvideos,memes
 * Logs: /tmp/daemon-<threadId>.log
 */

import { appendFileSync } from "fs";
import { execSync } from "child_process";
import { configManager } from "../dist/config-manager.js";
import { scrapeReelUrlsOnly } from "../dist/reel-scraper.js";
import { sendReelLinkToThread } from "../dist/reel-sender.js";
import { instagramBrowser } from "../dist/instagram-browser.js";

const [threadId, countStr, hashtagsStr] = process.argv.slice(2);

if (!threadId || !countStr || !hashtagsStr) {
  console.error("Usage: node scripts/group-daily-daemon.mjs <threadId> <count> <hashtag,...>");
  process.exit(1);
}

const COUNT     = parseInt(countStr, 10);
const HASHTAGS  = hashtagsStr.split(",").map(h => h.trim());
const WINDOW_MS = 24 * 60 * 60 * 1000;
const LOG_FILE  = `/tmp/daemon-${threadId}.log`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

const thread = configManager.getThread(threadId);
if (!thread) {
  console.error(`Thread "${threadId}" not found in config`);
  process.exit(1);
}

async function planWindow() {
  const windowStart = Date.now();
  log(`Planning next ${COUNT} sends for "${thread.threadName}" — window starts ${new Date(windowStart).toLocaleString()}`);

  // ── Scrape URLs ────────────────────────────────────────────────────────────
  let urls = [];
  try {
    const alreadySent = configManager.getGlobalSentUrls();
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

  // ── Random send times within window ───────────────────────────────────────
  const delays = Array.from({ length: sendUrls.length }, () => Math.random() * WINDOW_MS);
  delays.sort((a, b) => a - b);

  log(`Will send ${sendUrls.length} reels:`);
  delays.forEach((d, i) => {
    log(`  ${i + 1}. ${new Date(windowStart + d).toLocaleString()}  (+${(d / 60000).toFixed(1)} min)  ${sendUrls[i]}`);
  });

  // ── Schedule sends ─────────────────────────────────────────────────────────
  let completed = 0;
  sendUrls.forEach((url, i) => {
    setTimeout(async () => {
      log(`Sending ${i + 1}/${sendUrls.length}: ${url}`);
      try {
        const ok = await sendReelLinkToThread(thread.threadName, url);
        if (ok) {
          configManager.recordSentReel(threadId, url);
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
        const elapsed = Date.now() - windowStart;
        const nextDelay = Math.max(0, WINDOW_MS - elapsed);
        log(`Window complete. Next window in ${(nextDelay / 60000).toFixed(1)} min`);
        setTimeout(planWindow, nextDelay);
      }
    }, delays[i]);
  });
}

log(`=== Daily daemon started: "${thread.threadName}" | ${COUNT} reels/day | hashtags: ${HASHTAGS.join(", ")} ===`);
planWindow();
