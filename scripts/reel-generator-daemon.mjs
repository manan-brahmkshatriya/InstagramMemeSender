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
import { drawNextQuote, initDeck } from "./quotes.mjs";

// ── Paths ───────────────────────────────────────────────────────────────────
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE  = path.join(PROJECT_ROOT, ".reel-generator-config.json");
const LOG_FILE     = "/tmp/reel-generator-daemon.log";
const WINDOW_MS    = 24 * 60 * 60 * 1000; // 24 hours

// ── Hashtag sets — 8 rotating packs of 25-30 hashtags for maximum reach ────
// Instagram allows 30 hashtags. We rotate sets to avoid repetition penalties.
const HASHTAG_SETS = [
  "#motivation #success #mindset #inspiration #goals #hustle #entrepreneur #grind #blessed #lifestyle #positivevibes #motivationalquotes #dailymotivation #successmindset #believeinyourself #nevergiveup #workhard #ambition #dreambig #inspire #focus #discipline #selfimprovement #growth #winning",
  "#inspiration #life #love #happiness #quotes #motivational #positive #growth #winning #abundance #grateful #manifest #lawofattraction #affirmations #mindfulness #selfcare #personaldevelopment #innerpeace #consciousness #awakening #vibehigh #abundance #purpose #healing #growthmindset",
  "#discipline #hardwork #dedication #success #champion #grindset #wakeup #morningroutine #healthymindset #strongmind #consistency #habits #productivity #focusedmind #resultsonly #noexcuses #levelup #earnit #grit #relentless #unstoppable #dailygrind #powerful #limitless #rise",
  "#dailymotivation #morningmotivation #fitnessmotivation #businessmotivation #entrepreneurship #startuplife #CEO #leadershipquotes #businessmindset #millionairemindset #moneymindset #financialfreedom #successquotes #inspirationalquotes #quoteoftheday #quotesdaily #quotestoliveby #mindsetcoach #lifecoach #selfmastery",
  "#positivity #goodvibes #gratitude #blessed #universe #highvibes #selflove #selfbelief #innerstrength #resilience #comeback #transformation #changeyourlife #breakthrough #reinvention #growth #possibility #potential #confidence #empower #uplifting #encouragement #hope #faith #light",
  "#hustle #grind #businessowner #successhabits #millionairehabits #morningroutine #nightroutine #routines #productivity #deepwork #highperformance #peakperformance #focus #flowstate #mentalstrength #executivemindset #strategicthinking #leadershipdevelopment #personalbranding #contentcreator",
  "#quotes #lifequotes #deepquotes #powerfulmessage #quotestagram #quotesforlife #quotesinspiration #wordsofwisdom #wordstolive #mindsetquotes #successquotes #bossquotes #reelquotes #instaquotes #quotepost #thoughtoftheday #dailythought #insightful #realtalk #truth #perspective #wisdomquotes",
  "#reels #reelsvideo #reelsindia #reelsinstagram #reelstagram #instareels #viralreels #trendingreels #explore #explorepage #trending #viral #instadaily #instagood #content #contentcreation #creator #mindset #growth #motivation #success #inspire #dreams #hustle #believe",
];

// ── Caption builder — combines a short opener with a rich hashtag set ───────
const CAPTION_OPENERS = [
  "Start every day with a grateful heart 🌅",
  "Your only limit is your mind 💪",
  "Small steps every day = big changes 🌱",
  "The best view comes after the hardest climb 🏔️",
  "Be the energy you want to attract ✨",
  "Rise and grind — your future is waiting 🔥",
  "Believe it. Achieve it. Repeat 🎯",
  "Hard work always beats excuses 💥",
];

function buildCaption(captionIndex, hashtagIndex) {
  const opener  = CAPTION_OPENERS[captionIndex % CAPTION_OPENERS.length];
  const hashtags = HASHTAG_SETS[hashtagIndex % HASHTAG_SETS.length];
  return `${opener}\n\n${hashtags}`;
}

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

function recordPostedVideo(videoId, updatedConfig) {
  // updatedConfig already has the advanced deck position from drawNextQuote
  if (!updatedConfig.postedVideoIds.includes(videoId)) {
    updatedConfig.postedVideoIds.push(videoId);
  }
  updatedConfig.captionIndex   = ((updatedConfig.captionIndex ?? 0) + 1) % CAPTION_OPENERS.length;
  updatedConfig.hashtagIndex   = ((updatedConfig.hashtagIndex ?? 0) + 1) % HASHTAG_SETS.length;
  writeConfig(updatedConfig);
  log(`Recorded video ID ${videoId} — caption→${updatedConfig.captionIndex}, deck pos→${updatedConfig.quoteDeckPos}`);
}

// ── Post one reel ────────────────────────────────────────────────────────────
async function postOneReel(reelIndex) {
  const config = readConfig();

  if (!config.pexelsApiKey) {
    throw new Error("pexelsApiKey is not set in .reel-generator-config.json");
  }

  const theme   = config.themes[reelIndex % config.themes.length];

  // Draw the next unique quote from the shuffle-deck
  const { quote, updatedConfig } = drawNextQuote(config);
  const caption = buildCaption(updatedConfig.captionIndex ?? 0, updatedConfig.hashtagIndex ?? 0);

  log(`--- Posting reel ${reelIndex + 1}: theme="${theme}" ---`);
  log(`    Quote:   ${quote}`);
  log(`    Caption: ${caption.split("\n")[0]}  [+ ${caption.split(" ").filter(w=>w.startsWith("#")).length} hashtags]`);

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
    const uploadOk = await uploadReelToFeed(overlaidPath, caption, config.cookieFile, "https://www.instagram.com/riseclub9/");
    if (!uploadOk) throw new Error("uploadReelToFeed returned false");

    // Step 4: Record success
    recordPostedVideo(videoId, updatedConfig);
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

// Initialise shuffle-deck on first run (persists to config file)
const initialised = initDeck(cfg);
writeConfig(initialised);

log("=".repeat(60));
log("Reel Generator Daemon started");
log(`Account:     ${cfg.account}`);
log(`Daily count: ${cfg.dailyCount}`);
log(`Themes:      ${cfg.themes.join(", ")}`);
log(`Videos used: ${(cfg.postedVideoIds ?? []).length}`);
log(`Quote deck:  ${cfg.quoteDeckPos ?? 0} / ${cfg.quoteDeck?.length ?? 0} shown`);
log("=".repeat(60));

// Start the first window
planWindow();
