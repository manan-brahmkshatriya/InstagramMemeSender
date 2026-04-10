/**
 * test-one-reel.mjs
 * One-off test: runs the full pipeline once immediately.
 * Mirrors postOneReel() in reel-generator-daemon.mjs exactly.
 * Usage: node scripts/test-one-reel.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAndDownloadPexelsVideo, cleanupVideoFile } from "./pexels-video-fetcher.mjs";
import { uploadReelToFeed } from "./reel-feed-uploader.mjs";
import { overlayQuoteOnVideo, addBackgroundMusic } from "./video-quote-overlay.mjs";
import { drawNextQuote, initDeck } from "./quotes.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE  = path.join(PROJECT_ROOT, ".reel-generator-config.json");
const MUSIC_DIR    = path.join(PROJECT_ROOT, "scripts", "music");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Same arrays as in the daemon ─────────────────────────────────────────────
const CAPTION_OPENERS = [
  "Start every day with a grateful heart 🌅",
  "Your only limit is your mind 💪",
  "Small steps every day = big changes 🌱",
  "The best view comes after the hardest climb 🏔️",
  "Be the energy you want to attract ✨",
  "Rise and grind — your future is waiting 🔥",
  "Believe it. Achieve it. Repeat 🎯",
  "Hard work always beats excuses 💥",
  "Your story isn't over yet — keep writing it 📖",
  "Every master was once a disaster. Keep going 🌊",
  "The grind you do in private pays off in public 💼",
  "You were made for more than mediocrity 👑",
  "Progress beats perfection. Always 🎯",
  "What you do today creates every tomorrow 🌍",
  "Stay patient. Stay consistent. Trust the process ⏳",
  "Success is built in the quiet moments no one sees 🔑",
  "You are capable of more than you know 🚀",
  "Stop waiting for perfect. Start making it real ✅",
  "Great things take time. Trust yours 🌱",
  "One focused hour changes everything 💡",
];

const CALL_TO_ACTIONS = [
  "💾 Save this for when you need it most!",
  "💾 Save this and come back to it!",
  "💾 Bookmark this — you'll need it later!",
  "Tag someone who needs to hear this 👇",
  "Type YES if this resonates 🙌",
  "Drop a 🔥 if you needed this today!",
  "Share with someone who needs a boost 💫",
  "💾 Save for your low days ❤️",
  "Tag your accountability partner 👇",
  "💾 Save this before you scroll past!",
  "Type DONE if you're committing to this 👇",
  "Share this with someone who needs the push 🚀",
];

const HOOK_TEXTS = [
  "You need this today",
  "Read this carefully",
  "This will change your day",
  "Stop scrolling",
  "This one hits different",
  "Real talk",
  "Remember this",
  "Pay attention",
  "Don't skip this",
  "Hear this out",
  "Words to live by",
  "Print this out",
];

const HASHTAG_SETS = [
  "#motivation #success #mindset #inspiration #goals #hustle #entrepreneur #grind #blessed #lifestyle #positivevibes #motivationalquotes #dailymotivation #successmindset #believeinyourself #nevergiveup #workhard #ambition #dreambig #inspire #focus #discipline #selfimprovement #growth #winning",
  "#inspiration #life #love #happiness #quotes #motivational #positive #growth #winning #abundance #grateful #manifest #lawofattraction #affirmations #mindfulness #selfcare #personaldevelopment #innerpeace #consciousness #awakening #vibehigh #purpose #healing #growthmindset #riseup",
  "#discipline #hardwork #dedication #success #champion #grindset #wakeup #morningroutine #healthymindset #strongmind #consistency #habits #productivity #focusedmind #resultsonly #noexcuses #levelup #earnit #grit #relentless #unstoppable #dailygrind #powerful #limitless #rise",
  "#dailymotivation #morningmotivation #fitnessmotivation #businessmotivation #entrepreneurship #startuplife #CEO #leadershipquotes #businessmindset #millionairemindset #moneymindset #financialfreedom #successquotes #inspirationalquotes #quoteoftheday #quotesdaily #quotestoliveby #mindsetcoach #lifecoach #selfmastery",
  "#positivity #goodvibes #gratitude #blessed #universe #highvibes #selflove #selfbelief #innerstrength #resilience #comeback #transformation #changeyourlife #breakthrough #reinvention #growth #possibility #potential #confidence #empower #uplifting #encouragement #hope #faith #light",
  "#hustle #grind #businessowner #successhabits #millionairehabits #morningroutine #nightroutine #routines #productivity #deepwork #highperformance #peakperformance #focus #flowstate #mentalstrength #executivemindset #strategicthinking #leadershipdevelopment #personalbranding #contentcreator",
  "#quotes #lifequotes #deepquotes #powerfulmessage #quotestagram #quotesforlife #quotesinspiration #wordsofwisdom #wordstolive #mindsetquotes #successquotes #bossquotes #reelquotes #instaquotes #quotepost #thoughtoftheday #dailythought #insightful #realtalk #truth #perspective #wisdomquotes",
  "#reels #reelsvideo #reelsinstagram #reelstagram #instareels #viralreels #trendingreels #explore #explorepage #trending #viral #instadaily #instagood #content #contentcreation #creator #mindset #growth #motivation #success #inspire #dreams #hustle #believe #goalsetter",
];

function buildCaption(captionIndex, quote) {
  const opener = CAPTION_OPENERS[captionIndex % CAPTION_OPENERS.length];
  const cta    = CALL_TO_ACTIONS[captionIndex % CALL_TO_ACTIONS.length];
  return `${opener}\n\n"${quote}"\n\n${cta}`;
}

function pickRandomMusic() {
  try {
    if (!fs.existsSync(MUSIC_DIR)) return null;
    const files = fs.readdirSync(MUSIC_DIR)
      .filter(f => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f));
    if (files.length === 0) return null;
    const pick = files[Math.floor(Math.random() * files.length)];
    return path.join(MUSIC_DIR, pick);
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
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

const theme = config.themes?.[0] ?? "sunrise motivation";

// Draw the next unique quote from the shuffle-deck
const deckedConfig           = initDeck(config);
const { quote, updatedConfig } = drawNextQuote(deckedConfig);
const captionIdx             = updatedConfig.captionIndex ?? 0;
const hashtagIdx             = updatedConfig.hashtagIndex ?? 0;
const caption                = buildCaption(captionIdx, quote);
const hashtagComment         = HASHTAG_SETS[hashtagIdx % HASHTAG_SETS.length];
const hookText               = HOOK_TEXTS[captionIdx % HOOK_TEXTS.length];

log("=".repeat(60));
log("TEST: Full pipeline (quote + hook + music + caption + hashtag comment)");
log(`Theme:    ${theme}`);
log(`Quote:    ${quote}`);
log(`Hook:     ${hookText}`);
log(`Caption:  ${caption.split("\n")[0]}`);
log(`Hashtags: ${hashtagComment.split(" ").length} tags (first comment)`);
log("=".repeat(60));

let rawPath      = null;
let overlaidPath = null;
let videoId      = null;

try {
  // Step 1: Fetch video from Pexels
  log("\nStep 1: Fetching video from Pexels...");
  const result = await fetchAndDownloadPexelsVideo(
    theme,
    config.pexelsApiKey,
    config.postedVideoIds ?? []
  );
  rawPath = result.filePath;
  videoId = result.videoId;
  log(`✅ Downloaded Pexels ID=${videoId} (${result.width}x${result.height}) → ${rawPath}`);

  // Step 2: Burn quote + hook text onto video
  log("\nStep 2: Burning quote + hook text overlay...");
  overlaidPath = overlayQuoteOnVideo(rawPath, quote, undefined, hookText);
  log(`✅ Overlay complete → ${overlaidPath}`);
  log(`   Size: ${(fs.statSync(overlaidPath).size / 1024 / 1024).toFixed(2)} MB`);

  // Step 2.5: Mix background music
  const musicFile = pickRandomMusic();
  if (musicFile) {
    log(`\nStep 2.5: Mixing background music: ${path.basename(musicFile)}`);
    const musicalPath = addBackgroundMusic(overlaidPath, musicFile);
    cleanupVideoFile(overlaidPath);
    overlaidPath = musicalPath;
    log(`✅ Music mixed → ${overlaidPath}`);
    log(`   Size: ${(fs.statSync(overlaidPath).size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    log("\nStep 2.5: No music files found — skipping audio mix");
  }

  // Step 3: Upload to Instagram as Reel
  log("\nStep 3: Uploading to Instagram...");
  const uploadOk = await uploadReelToFeed(
    overlaidPath,
    caption,
    config.cookieFile,
    "https://www.instagram.com/riseclub9/",
    hashtagComment
  );

  if (uploadOk) {
    log("\n✅ TEST PASSED — Reel posted successfully!");

    // Save state
    if (!updatedConfig.postedVideoIds.includes(videoId)) {
      updatedConfig.postedVideoIds.push(videoId);
    }
    updatedConfig.captionIndex = (captionIdx + 1) % CAPTION_OPENERS.length;
    updatedConfig.hashtagIndex = (hashtagIdx + 1) % HASHTAG_SETS.length;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2), "utf-8");
    log(`Saved: video ID ${videoId}, deck pos ${updatedConfig.quoteDeckPos}/${updatedConfig.quoteDeck.length}`);
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
