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
import { drawNextQuote, initDeck } from "./quotes.mjs";

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

// Draw the next unique quote from the shuffle-deck
const deckedConfig        = initDeck(config);
const { quote, updatedConfig } = drawNextQuote(deckedConfig);

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
const opener   = CAPTION_OPENERS[(updatedConfig.captionIndex ?? 0) % CAPTION_OPENERS.length];
const hashtags = HASHTAG_SETS[(updatedConfig.hashtagIndex ?? 0) % HASHTAG_SETS.length];
const caption  = `${opener}\n\n${hashtags}`;

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
  const PROFILE_URL = "https://www.instagram.com/riseclub9/";
  const uploadOk = await uploadReelToFeed(overlaidPath, caption, config.cookieFile, PROFILE_URL);

  if (uploadOk) {
    log("\n✅ TEST PASSED — Reel with quote posted successfully!");

    // Record the video as used and persist the advanced deck position
    if (!updatedConfig.postedVideoIds.includes(videoId)) {
      updatedConfig.postedVideoIds.push(videoId);
    }
    updatedConfig.captionIndex = ((updatedConfig.captionIndex ?? 0) + 1) % CAPTION_OPENERS.length;
    updatedConfig.hashtagIndex = ((updatedConfig.hashtagIndex ?? 0) + 1) % HASHTAG_SETS.length;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2), "utf-8");
    log(`Recorded Pexels ID ${videoId}, deck pos: ${updatedConfig.quoteDeckPos}/${updatedConfig.quoteDeck.length}`);
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
