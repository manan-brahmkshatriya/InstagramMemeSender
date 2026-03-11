/**
 * rolling-send.mjs
 * Usage: node scripts/rolling-send.mjs <threadId> <count> <windowHours> <hashtag,...>
 * Example: node scripts/rolling-send.mjs nitisha-sheth 5 12 funny,funnyvideos,memes
 *
 * Scrapes <count> reel URLs from the given hashtags, then sends them to the
 * configured thread at random times spread across a <windowHours>-hour window.
 */

import { configManager } from "../dist/config-manager.js";
import { scrapeReelUrlsOnly } from "../dist/reel-scraper.js";
import { sendReelLinkToThread } from "../dist/reel-sender.js";
import { instagramBrowser } from "../dist/instagram-browser.js";

const [threadId, countStr, windowHoursStr, hashtagsStr] = process.argv.slice(2);

if (!threadId || !countStr || !windowHoursStr || !hashtagsStr) {
  console.error("Usage: node scripts/rolling-send.mjs <threadId> <count> <windowHours> <hashtag,...>");
  process.exit(1);
}

const COUNT        = parseInt(countStr, 10);
const WINDOW_MS    = parseFloat(windowHoursStr) * 60 * 60 * 1000;
const HASHTAGS     = hashtagsStr.split(",").map(h => h.trim());

const thread = configManager.getThread(threadId);
if (!thread) { console.error(`Thread "${threadId}" not found`); process.exit(1); }

console.log(`[rolling-send] thread=${threadId} (${thread.threadName}), count=${COUNT}, window=${windowHoursStr}h`);
console.log(`[rolling-send] hashtags: ${HASHTAGS.join(", ")}`);

// ── 1. Scrape URLs upfront ───────────────────────────────────────────────────
const alreadySent = configManager.getGlobalSentUrls(); // global dedup across all threads
console.log(`[rolling-send] scraping ${COUNT + 2} URLs (buffer for failures)…`);
const urls = await scrapeReelUrlsOnly(HASHTAGS, COUNT + 2, alreadySent);

if (urls.length < COUNT) {
  console.warn(`[rolling-send] only found ${urls.length} new URLs (wanted ${COUNT})`);
}
const sendUrls = urls.slice(0, COUNT);
console.log(`[rolling-send] will send ${sendUrls.length} reels:`);
sendUrls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

// Close browser — reopen fresh for each send to avoid stale pages
await instagramBrowser.close();

// ── 2. Generate random send times within window ──────────────────────────────
const delays = Array.from({ length: sendUrls.length }, () => Math.random() * WINDOW_MS);
delays.sort((a, b) => a - b);

const now = Date.now();
console.log("\n[rolling-send] scheduled send times:");
delays.forEach((d, i) => {
  const at = new Date(now + d);
  console.log(`  ${i + 1}. ${at.toLocaleTimeString()} (+${(d / 60000).toFixed(1)} min)`);
});

// ── 3. Schedule each send ────────────────────────────────────────────────────
let completed = 0;
sendUrls.forEach((url, i) => {
  setTimeout(async () => {
    console.log(`\n[rolling-send] sending ${i + 1}/${sendUrls.length}: ${url}`);
    try {
      const ok = await sendReelLinkToThread(thread.threadName, url);
      if (ok) {
        configManager.recordSentReel(threadId, url);
        console.log(`[rolling-send] ✓ sent ${i + 1}/${sendUrls.length}`);
      } else {
        console.log(`[rolling-send] ✗ failed ${i + 1}/${sendUrls.length}`);
      }
      await instagramBrowser.close();
    } catch (err) {
      console.error(`[rolling-send] error on send ${i + 1}:`, err.message);
      await instagramBrowser.close().catch(() => {});
    }
    completed++;
    if (completed === sendUrls.length) {
      console.log("\n[rolling-send] all done. exiting.");
      process.exit(0);
    }
  }, delays[i]);
});

console.log("\n[rolling-send] process is running — waiting for scheduled sends…");
