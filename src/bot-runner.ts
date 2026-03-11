import { configManager } from "./config-manager.js";
import { scrapeForCategories, scrapeReelUrlsOnly } from "./reel-scraper.js";
import { downloadReel, cleanupTempFile } from "./reel-downloader.js";
import { sendReelToThread, sendReelUrlToThread, sendReelLinkToThread } from "./reel-sender.js";
import { log, logError } from "./logger.js";
import type { InstagramThread, SendResult } from "./types.js";

const INTER_REEL_DELAY_MIN = 5000;  // 5s min between reels
const INTER_REEL_DELAY_MAX = 10000; // 10s max between reels
const INTER_THREAD_DELAY = 10000;   // 10s between threads

async function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the bot for a single thread:
 * 1. Check daily limit (auto-reset at midnight)
 * 2. Collect hashtags from subscribed categories
 * 3. Scrape reels (with buffer for failures and duplicates)
 * 4. Download and send each fresh reel
 * 5. Record sent reels in history
 */
export async function runForThread(thread: InstagramThread): Promise<SendResult> {
  const result: SendResult = {
    threadId: thread.threadId,
    sent: 0,
    skipped: 0,
    errors: [],
  };

  log(`bot-runner: starting run for thread "${thread.threadId}" (${thread.threadName})`);

  // Check and auto-reset daily count
  const history = configManager.getOrResetDailyCount(thread.threadId);
  const remainingToday = thread.dailyLimit - history.dailyCount;

  if (remainingToday <= 0) {
    log(
      `bot-runner: thread "${thread.threadId}" has reached daily limit (${thread.dailyLimit})`
    );
    result.skipped = thread.dailyLimit;
    return result;
  }

  // Collect hashtags from subscribed categories
  const allCategories = configManager.getCategories();
  const subscribedCategories = allCategories.filter((c) =>
    thread.categories.includes(c.name)
  );
  const hashtags = Array.from(
    new Set(subscribedCategories.flatMap((c) => c.hashtags))
  );

  if (hashtags.length === 0) {
    const msg = `No hashtags found for subscribed categories: ${thread.categories.join(", ")}`;
    log(`bot-runner: ${msg}`);
    result.errors.push(msg);
    return result;
  }

  // Global dedup — never repeat a reel across ANY thread
  const alreadySentUrls = configManager.getGlobalSentUrls();

  // Keep scrape target tight for faster "send one now" runs while retaining small fallback.
  const scrapeTarget = Math.min(remainingToday + 1, 3);
  log(
    `bot-runner: scraping up to ${scrapeTarget} reels for "${thread.threadId}" (need ${remainingToday})`
  );

  let scrapedReels;
  try {
    scrapedReels = await scrapeForCategories(hashtags, scrapeTarget, alreadySentUrls);
  } catch (err) {
    logError(`bot-runner: scraping failed for "${thread.threadId}"`, err);
    result.errors.push(
      `Scraping failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  log(`bot-runner: scraped ${scrapedReels.length} reels for "${thread.threadId}"`);

  // Send each fresh reel (scraper already filters by alreadySentUrls, but double-check)
  for (const reel of scrapedReels) {
    if (result.sent >= remainingToday) break;

    // Final dedup check
    if (alreadySentUrls.has(reel.reelUrl)) {
      result.skipped++;
      continue;
    }

    let tmpFilePath: string | null = null;
    try {
      // Download to temp file immediately (CDN URLs expire)
      const downloaded = await downloadReel(reel);
      tmpFilePath = downloaded.tmpFilePath;

      // Send to Instagram thread
      const success = await sendReelToThread(thread.threadName, downloaded);

      if (success) {
        configManager.recordSentReel(thread.threadId, reel.reelUrl);
        alreadySentUrls.add(reel.reelUrl); // prevent duplicate in same run
        result.sent++;
        log(
          `bot-runner: sent reel ${result.sent}/${remainingToday} to "${thread.threadId}"`
        );
      } else {
        result.errors.push(`Failed to send reel: ${reel.reelUrl}`);
        log(
          `bot-runner: failed to send reel ${reel.reelUrl} to "${thread.threadId}"`
        );
      }
    } catch (err) {
      logError(`bot-runner: error processing reel ${reel.reelUrl}`, err);
      result.errors.push(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // Always clean up temp file
      if (tmpFilePath) cleanupTempFile(tmpFilePath);
    }

    // Delay between reels to avoid rate limiting
    if (result.sent < remainingToday) {
      await delay(INTER_REEL_DELAY_MIN, INTER_REEL_DELAY_MAX);
    }
  }

  log(
    `bot-runner: finished "${thread.threadId}": sent=${result.sent}, skipped=${result.skipped}, errors=${result.errors.length}`
  );
  return result;
}

/**
 * No-view variant: grabs reel URLs from hashtag pages without visiting
 * individual reels, then shares each via the reel share modal.
 */
export async function runForThreadNoView(thread: InstagramThread): Promise<SendResult> {
  const result: SendResult = {
    threadId: thread.threadId,
    sent: 0,
    skipped: 0,
    errors: [],
  };

  log(`bot-runner: (no-view) starting run for thread "${thread.threadId}" (${thread.threadName})`);

  const history = configManager.getOrResetDailyCount(thread.threadId);
  const remainingToday = thread.dailyLimit - history.dailyCount;

  if (remainingToday <= 0) {
    log(`bot-runner: (no-view) thread "${thread.threadId}" has reached daily limit (${thread.dailyLimit})`);
    result.skipped = thread.dailyLimit;
    return result;
  }

  const allCategories = configManager.getCategories();
  const subscribedCategories = allCategories.filter((c) =>
    thread.categories.includes(c.name)
  );
  const hashtags = Array.from(
    new Set(subscribedCategories.flatMap((c) => c.hashtags))
  );

  if (hashtags.length === 0) {
    const msg = `No hashtags found for subscribed categories: ${thread.categories.join(", ")}`;
    log(`bot-runner: (no-view) ${msg}`);
    result.errors.push(msg);
    return result;
  }

  // Global dedup — never repeat a reel across ANY thread
  const alreadySentUrls = configManager.getGlobalSentUrls();

  let reelUrls: string[];
  try {
    reelUrls = await scrapeReelUrlsOnly(hashtags, remainingToday + 2, alreadySentUrls);
  } catch (err) {
    logError(`bot-runner: (no-view) scraping failed for "${thread.threadId}"`, err);
    result.errors.push(`Scraping failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  log(`bot-runner: (no-view) found ${reelUrls.length} candidate URLs for "${thread.threadId}"`);

  for (const reelUrl of reelUrls) {
    if (result.sent >= remainingToday) break;
    if (alreadySentUrls.has(reelUrl)) {
      result.skipped++;
      continue;
    }

    try {
      const success = await sendReelLinkToThread(thread.threadName, reelUrl);
      if (success) {
        configManager.recordSentReel(thread.threadId, reelUrl);
        alreadySentUrls.add(reelUrl);
        result.sent++;
        log(`bot-runner: (no-view) sent reel ${result.sent}/${remainingToday} to "${thread.threadId}"`);
      } else {
        result.errors.push(`Failed to send reel: ${reelUrl}`);
      }
    } catch (err) {
      logError(`bot-runner: (no-view) error sending ${reelUrl}`, err);
      result.errors.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (result.sent < remainingToday) {
      await delay(INTER_REEL_DELAY_MIN, INTER_REEL_DELAY_MAX);
    }
  }

  log(`bot-runner: (no-view) finished "${thread.threadId}": sent=${result.sent}, skipped=${result.skipped}, errors=${result.errors.length}`);
  return result;
}

/** Run the bot for all enabled threads. */
export async function runForAllThreads(): Promise<SendResult[]> {
  const threads = configManager.getThreads().filter((t) => t.enabled);
  log(`bot-runner: running for ${threads.length} enabled threads`);

  const results: SendResult[] = [];

  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i];
    try {
      const result = await runForThread(thread);
      results.push(result);
    } catch (err) {
      logError(`bot-runner: unhandled error for thread "${thread.threadId}"`, err);
      results.push({
        threadId: thread.threadId,
        sent: 0,
        skipped: 0,
        errors: [
          `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
        ],
      });
    }

    // Delay between threads (skip after last)
    if (i < threads.length - 1) {
      await delay(INTER_THREAD_DELAY, INTER_THREAD_DELAY);
    }
  }

  return results;
}
