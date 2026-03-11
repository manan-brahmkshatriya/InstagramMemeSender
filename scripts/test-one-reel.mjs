/**
 * test-one-reel.mjs
 * One-off test: fetch a Pexels video, burn a quote on it, upload as Reel to riseclub9.
 * Usage: node scripts/test-one-reel.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAndDownloadPexelsVideo, cleanupVideoFile } from "./pexels-video-fetcher.mjs";
import { uploadReelToFeed } from "./reel-feed-uploader.mjs";
import { overlayQuoteOnVideo } from "./video-quote-overlay.mjs";
import { pickNextQuote } from "./quotes.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE  = path.join(PROJECT_ROOT, ".reel-generator-config.json");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));

if (!config.pexelsApiKey || config.pexelsApiKey === "YOUR_PEXELS_API_KEY_HERE") {
  log("ERROR: pexelsApiKey not set in .reel-generator-config.json");
  process.exit(1);
}
if (!fs.existsSync(config.cookieFile)) {
  log(`ERROR: Cookie file not found: ${config.cookieFile}`);
  log("  → Run: node scripts/manual-login-riseclub9.mjs");
  process.exit(1);
}

const theme   = "sunrise motivation";
const caption = "Start every day with a grateful heart 🌅 #motivation #inspiration #mindset #success #dailymotivation";
const { quote } = pickNextQuote(config.quoteIndex ?? 0);

log("=".repeat(60));
log("TEST: One-off Reel upload to riseclub9 (with quote overlay)");
log(`Theme:   ${theme}`);
log(`Quote:   ${quote}`);
log(`Caption: ${caption}`);
log("=".repeat(60));

let rawPath      = null;
let overlaidPath = null;
let videoId      = null;

try {
  // Step 1: Fetch and download from Pexels
  log("\nStep 1: Fetching video from Pexels...");
  const result = await fetchAndDownloadPexelsVideo(
    theme,
    config.pexelsApiKey,
    config.postedVideoIds ?? []
  );
  rawPath = result.filePath;
  videoId  = result.videoId;
  log(`✅ Downloaded Pexels ID=${videoId} (${result.width}x${result.height}) → ${rawPath}`);

  // Step 2: Burn the quote onto the video
  log("\nStep 2: Burning quote onto video...");
  overlaidPath = overlayQuoteOnVideo(rawPath, quote);
  log(`✅ Overlay complete → ${overlaidPath}`);
  log(`   File size: ${(fs.statSync(overlaidPath).size / 1024 / 1024).toFixed(2)} MB`);

  // Step 3: Upload to Instagram as Reel
  log("\nStep 3: Uploading to Instagram as Reel...");
  const uploadOk = await uploadReelToFeed(overlaidPath, caption, config.cookieFile);

  if (uploadOk) {
    log("\n✅ TEST PASSED — Reel with quote posted successfully!");

    // Record the video as used and advance quote index
    if (!config.postedVideoIds.includes(videoId)) {
      config.postedVideoIds.push(videoId);
    }
    config.captionIndex = ((config.captionIndex ?? 0) + 1) % 4;
    const { nextIndex } = pickNextQuote(config.quoteIndex ?? 0);
    config.quoteIndex   = nextIndex;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    log(`Recorded Pexels ID ${videoId}, next quoteIndex: ${config.quoteIndex}`);
  } else {
    log("\n❌ TEST FAILED — uploadReelToFeed returned false");
    process.exit(1);
  }

} catch (err) {
  log(`\n❌ TEST ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);

} finally {
  if (rawPath)      cleanupVideoFile(rawPath);
  if (overlaidPath) cleanupVideoFile(overlaidPath);
}
