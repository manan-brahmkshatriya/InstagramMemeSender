/**
 * reel-generator-daemon.mjs
 * 24/7 daemon: fetches Pexels videos, burns a motivational quote on them,
 * and posts 4 Reels/day to the riseclub9 Instagram feed.
 * Runs via LaunchAgent (com.instagrambot.riseclub9-reels.plist).
 *
 * Config: .reel-generator-config.json (in project root)
 * Logs:   /tmp/reel-generator-daemon.log
 *
 * Usage: node scripts/reel-generator-daemon.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAndDownloadPexelsVideo, cleanupVideoFile } from "./pexels-video-fetcher.mjs";
import { uploadReelToFeed } from "./reel-feed-uploader.mjs";
import { overlayQuoteOnVideo } from "./video-quote-overlay.mjs";
import { pickNextQuote } from "./quotes.mjs";

// ── Paths ───────────────────────────────────────────────────────────────────
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE  = path.join(PROJECT_ROOT, ".reel-generator-config.json");
const LOG_FILE     = "/tmp/reel-generator-daemon.log";
const WINDOW_MS    = 24 * 60 * 60 * 1000; // 24 hours

// ── Caption pool — Instagram caption with hashtags, rotated each post ───────
const CAPTIONS = [
  "Start every day with a grateful heart 🌅 #motivation #inspiration #mindset #success #dailymotivation",
  "Your only limit is your mind 💪 #motivational #inspiration #growth #mindset #success",
  "Small steps every day = big changes 🌱 #motivation #progress #consistency #success #goals",
  "The best view comes after the hardest climb 🏔️ #inspiration #nature #motivation #success #life",
];

// ── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

// ── Config helpers ───────────────────────────────────────────────────────────
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch (err) {
    log(`ERROR reading config: ${err.message}`);
  }
  return {
    pexelsApiKey:   "",
    account:        "riseclub9",
    cookieFile:     path.join(PROJECT_ROOT, ".instagram-session/cookies-riseclub9.json"),
    dailyCount:     4,
    themes:         ["sunrise motivation", "nature inspiration", "success mindset", "peaceful morning"],
    postedVideoIds: [],
    captionIndex:   0,
    quoteIndex:     0,
  };
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

function recordPostedVideo(videoId) {
  const config = readConfig();
  if (!config.postedVideoIds.includes(videoId)) {
    config.postedVideoIds.push(videoId);
  }
  // Advance both caption and quote indices
  config.captionIndex = ((config.captionIndex ?? 0) + 1) % CAPTIONS.length;
  const { nextIndex }  = pickNextQuote(config.quoteIndex ?? 0);
  config.quoteIndex    = nextIndex;
  writeConfig(config);
  log(`Recorded video ID ${videoId} — caption→${config.captionIndex}, quote→${config.quoteIndex}`);
}

// ── Post one reel ────────────────────────────────────────────────────────────
async function postOneReel(reelIndex) {
  const config = readConfig();

  if (!config.pexelsApiKey) {
    throw new Error("pexelsApiKey is not set in .reel-generator-config.json");
  }

  const theme   = config.themes[reelIndex % config.themes.length];
  const caption = CAPTIONS[(config.captionIndex ?? 0) % CAPTIONS.length];

  // Pick a unique motivational quote for the video overlay
  const { quote } = pickNextQuote(config.quoteIndex ?? 0);

  log(`--- Posting reel ${reelIndex + 1}: theme="${theme}" ---`);
  log(`    Quote:   ${quote}`);
  log(`    Caption: ${caption}`);

  let rawFilePath     = null;
  let overlaidPath    = null;
  let videoId         = null;

  try {
    // Step 1: Fetch and download from Pexels
    const result = await fetchAndDownloadPexelsVideo(
      theme,
      config.pexelsApiKey,
      config.postedVideoIds ?? []
    );
    rawFilePath = result.filePath;
    videoId     = result.videoId;
    log(`Downloaded Pexels ID=${videoId} (${result.width}x${result.height})`);

    // Step 2: Burn the motivational quote onto the video
    log("Applying quote overlay...");
    overlaidPath = overlayQuoteOnVideo(rawFilePath, quote);
    log(`Overlay complete → ${overlaidPath}`);

    // Step 3: Upload the overlaid video to Instagram as Reel
    const uploadOk = await uploadReelToFeed(overlaidPath, caption, config.cookieFile);
    if (!uploadOk) throw new Error("uploadReelToFeed returned false");

    // Step 4: Record success
    recordPostedVideo(videoId);
    log(`✅ Reel ${reelIndex + 1} posted successfully (Pexels ID ${videoId})`);
    return true;

  } catch (err) {
    log(`❌ Failed to post reel ${reelIndex + 1}: ${err.message}`);
    throw err;

  } finally {
    // Always delete local video files
    if (rawFilePath)  cleanupVideoFile(rawFilePath);
    if (overlaidPath) cleanupVideoFile(overlaidPath);
  }
}

// ── Rolling 24-hour window ───────────────────────────────────────────────────
async function planWindow() {
  const config   = readConfig();
  const count    = config.dailyCount ?? 4;
  const winStart = Date.now();

  log(`\n${"=".repeat(60)}`);
  log(`Planning window: ${count} reels over 24h`);
  log(`Window starts: ${new Date(winStart).toLocaleString()}`);

  const slotMs = WINDOW_MS / count;
  const delays = Array.from({ length: count }, (_, i) => {
    const slotStart      = i * slotMs;
    const effectiveStart = i === 0 ? slotStart + 30 * 60 * 1000 : slotStart;
    const slotEnd        = (i + 1) * slotMs;
    return effectiveStart + Math.random() * (slotEnd - effectiveStart);
  });

  log("Scheduled times:");
  delays.forEach((d, i) => {
    const at = new Date(winStart + d);
    log(`  ${i + 1}. ${at.toLocaleString()}  (in ${(d / 60000).toFixed(0)} min)`);
  });

  let completed = 0;
  let failed    = 0;

  for (let i = 0; i < delays.length; i++) {
    const delay     = delays[i];
    const reelIndex = i;

    setTimeout(async () => {
      log(`\n>>> Reel ${reelIndex + 1}/${count} firing at ${new Date().toLocaleString()}`);
      try {
        await postOneReel(reelIndex);
      } catch {
        failed++;
      } finally {
        completed++;
      }

      if (completed === count) {
        const elapsed   = Date.now() - winStart;
        const remaining = Math.max(0, WINDOW_MS - elapsed);
        log(`\nWindow complete: ${count - failed} succeeded, ${failed} failed`);
        log(`Next window in ${(remaining / 60000).toFixed(1)} min`);
        setTimeout(planWindow, remaining);
      }
    }, delay);
  }
}

// ── Startup checks ───────────────────────────────────────────────────────────
const cfg = readConfig();

if (!cfg.pexelsApiKey || cfg.pexelsApiKey === "YOUR_PEXELS_API_KEY_HERE") {
  log("FATAL: pexelsApiKey is not set in .reel-generator-config.json");
  log(`  → Edit: ${CONFIG_FILE}`);
  log("  → Get a free key at: https://www.pexels.com/api/");
  process.exit(1);
}

if (!fs.existsSync(cfg.cookieFile)) {
  log(`FATAL: Cookie file not found: ${cfg.cookieFile}`);
  log("  → Run: node scripts/manual-login-riseclub9.mjs");
  process.exit(1);
}

log("=".repeat(60));
log("Reel Generator Daemon started");
log(`Account:     ${cfg.account}`);
log(`Daily count: ${cfg.dailyCount}`);
log(`Themes:      ${cfg.themes.join(", ")}`);
log(`Videos used: ${(cfg.postedVideoIds ?? []).length}`);
log(`Quote index: ${cfg.quoteIndex ?? 0}`);
log("=".repeat(60));

// Ensure quoteIndex exists in config
if (cfg.quoteIndex === undefined) {
  cfg.quoteIndex = 0;
  writeConfig(cfg);
}

// Start the first window
planWindow();
