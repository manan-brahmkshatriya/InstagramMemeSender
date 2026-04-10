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
import { overlayQuoteOnVideo, addBackgroundMusic } from "./video-quote-overlay.mjs";
import { drawNextQuote, initDeck } from "./quotes.mjs";
import { ensureMusicLibrary } from "./pixabay-music-fetcher.mjs";

// ── Paths ───────────────────────────────────────────────────────────────────
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE  = path.join(PROJECT_ROOT, ".reel-generator-config.json");
const LOG_FILE     = "/tmp/reel-generator-daemon.log";
// ── Posting window: only post between 7 AM and 9 PM local time ──────────────
const POSTING_START_HOUR = 7;   // 7 AM local time
const POSTING_END_HOUR   = 21;  // 9 PM local time

// ── Hashtag sets — 15 rotating packs of 25-30 hashtags for maximum reach ────
// Instagram allows 30 hashtags. We rotate sets to avoid repetition penalties.
const HASHTAG_SETS = [
  "#motivation #success #mindset #inspiration #goals #hustle #entrepreneur #grind #blessed #lifestyle #positivevibes #motivationalquotes #dailymotivation #successmindset #believeinyourself #nevergiveup #workhard #ambition #dreambig #inspire #focus #discipline #selfimprovement #growth #winning",
  "#inspiration #life #love #happiness #quotes #motivational #positive #growth #winning #abundance #grateful #manifest #lawofattraction #affirmations #mindfulness #selfcare #personaldevelopment #innerpeace #consciousness #awakening #vibehigh #purpose #healing #growthmindset #riseup",
  "#discipline #hardwork #dedication #success #champion #grindset #wakeup #morningroutine #healthymindset #strongmind #consistency #habits #productivity #focusedmind #resultsonly #noexcuses #levelup #earnit #grit #relentless #unstoppable #dailygrind #powerful #limitless #rise",
  "#dailymotivation #morningmotivation #fitnessmotivation #businessmotivation #entrepreneurship #startuplife #CEO #leadershipquotes #businessmindset #millionairemindset #moneymindset #financialfreedom #successquotes #inspirationalquotes #quoteoftheday #quotesdaily #quotestoliveby #mindsetcoach #lifecoach #selfmastery",
  "#positivity #goodvibes #gratitude #blessed #universe #highvibes #selflove #selfbelief #innerstrength #resilience #comeback #transformation #changeyourlife #breakthrough #reinvention #growth #possibility #potential #confidence #empower #uplifting #encouragement #hope #faith #light",
  "#hustle #grind #businessowner #successhabits #millionairehabits #morningroutine #nightroutine #routines #productivity #deepwork #highperformance #peakperformance #focus #flowstate #mentalstrength #executivemindset #strategicthinking #leadershipdevelopment #personalbranding #contentcreator",
  "#quotes #lifequotes #deepquotes #powerfulmessage #quotestagram #quotesforlife #quotesinspiration #wordsofwisdom #wordstolive #mindsetquotes #successquotes #bossquotes #reelquotes #instaquotes #quotepost #thoughtoftheday #dailythought #insightful #realtalk #truth #perspective #wisdomquotes",
  "#reels #reelsvideo #reelsinstagram #reelstagram #instareels #viralreels #trendingreels #explore #explorepage #trending #viral #instadaily #instagood #content #contentcreation #creator #mindset #growth #motivation #success #inspire #dreams #hustle #believe #goalsetter",
  "#wellness #mentalhealth #mindfulness #selfcare #healingjourney #emotionalhealth #innerwork #breathe #journaling #gratefulmind #peacefulmind #dailymindfulness #presencepractice #mentalfitness #calmmind #grounded #anxiety #mentalwellness #selfhealing #mindfulmoment #groundedlife",
  "#fitnessmotivation #gymlife #workout #fitlife #health #training #athlete #bodygoals #exercise #getfit #fitnessjourney #strongbody #strongmind #fitness #physique #gym #healthylifestyle #workoutmotivation #activelife #fitnessgoals #buildyourbody #healthiswealth #trainhard",
  "#leadership #teamwork #leadershipdevelopment #ceo #executivemindset #buildculture #vision #strategy #coaching #leadershipquotes #mentorship #businessleader #executiveleader #growthmindset #empowerteam #successleader #bossup #servantleader #leadin #inspireothers #buildpeople",
  "#morningmotivation #goodmorning #morningroutine #sunrisevibes #earlybird #morningperson #wakeup #riseandshine #morningmindset #morningthoughts #starttheday #motivationmonday #positivemorning #newday #freshstart #morningenergy #risingstrong #dailyaffirmation #morningvibes #7amclub",
  "#studymotivation #learning #education #knowledgeispower #learneveryday #studentgrind #studygoals #selfstudying #bookworm #readmore #alwayslearning #growthmindset #investinyourself #skillbuilding #personaldevelopment #lifelonglearner #readbooks #levelup #mindexpansion #learnandgrow",
  "#weekendmotivation #saturday #sunday #weekendwarrior #productiveweekend #selfimprovement #weekendgrind #weekendgoals #recharge #selfgrowth #sundaymotivation #saturdaymotivation #restday #mentalrecharge #reflection #weekendlove #prepareyourself #rechargeyourbatteries #sundayvibes",
  "#riseandshine #morningpeople #grindneverstops #buildyourdream #successjourney #abundancemindset #wealthmindset #positivemindset #entrepreneurlife #createyourlife #livefully #livewithpurpose #dreambigger #taketheleap #ownyourfuture #beunstoppable #motivateothers #mondaymotivation #keeprising #stayfocused",
];

// ── Caption openers — short punchy first line ────────────────────────────────
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

// ── Call-to-action lines (drive saves — #1 algorithmic signal) ───────────────
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

// ── Hook texts burned onto the video (no emojis — safer for ffmpeg) ──────────
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

// ── Caption: opener + quote + CTA (clean — no hashtags) ─────────────────────
// Hashtags go in the first comment (cleaner caption = higher engagement)
function buildCaption(captionIndex, quote) {
  const opener = CAPTION_OPENERS[captionIndex % CAPTION_OPENERS.length];
  const cta    = CALL_TO_ACTIONS[captionIndex % CALL_TO_ACTIONS.length];
  return `${opener}\n\n"${quote}"\n\n${cta}`;
}

// ── First comment: the full hashtag pack ────────────────────────────────────
function buildHashtagComment(hashtagIndex) {
  return HASHTAG_SETS[hashtagIndex % HASHTAG_SETS.length];
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
    dailyCount:     3,
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

// ── Pick a random music file from scripts/music/ (if any exist) ─────────────
const MUSIC_DIR = path.join(PROJECT_ROOT, "scripts", "music");

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

// ── Retry helper: retries an async fn up to maxAttempts on network errors ────
async function withRetry(fn, maxAttempts = 3, delayMs = 15000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isNetwork = err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" ||
                        err.code === "ETIMEDOUT"  || err.code === "ECONNRESET"  ||
                        err.message.includes("fetch failed");
      if (isNetwork && attempt < maxAttempts) {
        log(`Network error (attempt ${attempt}/${maxAttempts}): ${err.message} — retrying in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
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
  const captionIdx    = updatedConfig.captionIndex ?? 0;
  const hashtagIdx    = updatedConfig.hashtagIndex ?? 0;
  const caption       = buildCaption(captionIdx, quote);
  const hashtagComment = buildHashtagComment(hashtagIdx);
  const hookText      = HOOK_TEXTS[captionIdx % HOOK_TEXTS.length];

  log(`--- Posting reel ${reelIndex + 1}: theme="${theme}" ---`);
  log(`    Quote:   ${quote}`);
  log(`    Hook:    ${hookText}`);
  log(`    Caption: ${caption.split("\n")[0]}`);
  log(`    Hashtags (first comment): ${hashtagComment.split(" ").length} tags`);

  let rawFilePath     = null;
  let overlaidPath    = null;
  let videoId         = null;

  try {
    // Step 1: Fetch and download from Pexels (with retry on network errors)
    const result = await withRetry(() => fetchAndDownloadPexelsVideo(
      theme,
      config.pexelsApiKey,
      config.postedVideoIds ?? []
    ));
    rawFilePath = result.filePath;
    videoId     = result.videoId;
    log(`Downloaded Pexels ID=${videoId} (${result.width}x${result.height})`);

    // Step 2: Burn the motivational quote + hook text onto the video
    log("Applying quote overlay...");
    overlaidPath = overlayQuoteOnVideo(rawFilePath, quote, undefined, hookText);
    log(`Overlay complete → ${overlaidPath}`);

    // Step 2.5: Mix in background music (if any .mp3/.m4a files exist in scripts/music/)
    const musicFile = pickRandomMusic();
    if (musicFile) {
      log(`Mixing background music: ${path.basename(musicFile)}`);
      const musicalPath = addBackgroundMusic(overlaidPath, musicFile);
      cleanupVideoFile(overlaidPath);
      overlaidPath = musicalPath;
      log(`Music mixed → ${overlaidPath}`);
    } else {
      log("No music files in scripts/music/ — uploading without background audio");
    }

    // Step 3: Upload the overlaid video to Instagram as Reel
    const uploadOk = await uploadReelToFeed(overlaidPath, caption, config.cookieFile, "https://www.instagram.com/riseclub9/", hashtagComment);
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

// ── Returns today's (or tomorrow's) 7 AM–9 PM posting window bounds ─────────
function getWindowBounds() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), POSTING_START_HOUR, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), POSTING_END_HOUR,   0, 0, 0);

  if (now.getTime() < end.getTime()) {
    // Still within (or before) today's window
    const winStart = Math.max(now.getTime(), start.getTime());
    return { winStart, winEnd: end.getTime() };
  }

  // Past 9 PM — use tomorrow's window
  const tStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, POSTING_START_HOUR, 0, 0, 0);
  const tEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, POSTING_END_HOUR,   0, 0, 0);
  return { winStart: tStart.getTime(), winEnd: tEnd.getTime() };
}

// ── 7 AM–9 PM daily posting window ──────────────────────────────────────────
async function planWindow() {
  const config = readConfig();
  const count  = config.dailyCount ?? 3;
  const now    = Date.now();

  const { winStart, winEnd } = getWindowBounds();
  const availableMs = winEnd - winStart;
  const delayToStart = Math.max(0, winStart - now);

  log(`\n${"=".repeat(60)}`);
  log(`Planning window: ${count} reels  |  7 AM – 9 PM only`);
  log(`Window: ${new Date(winStart).toLocaleString()} → ${new Date(winEnd).toLocaleString()}`);
  if (delayToStart > 0) {
    log(`Waiting ${(delayToStart / 60000).toFixed(0)} min until posting window opens (7 AM)...`);
  }

  const slotMs = availableMs / count;
  const absoluteTimes = Array.from({ length: count }, (_, i) => {
    const slotStart = winStart + i * slotMs;
    const slotEnd   = winStart + (i + 1) * slotMs;
    return slotStart + Math.random() * (slotEnd - slotStart);
  });

  log("Scheduled times:");
  absoluteTimes.forEach((t, i) => {
    const msFromNow = t - now;
    log(`  ${i + 1}. ${new Date(t).toLocaleString()}  (in ${(msFromNow / 60000).toFixed(0)} min)`);
  });

  let completed = 0;
  let failed    = 0;

  for (let i = 0; i < absoluteTimes.length; i++) {
    const delay     = Math.max(0, absoluteTimes[i] - Date.now());
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
        // Schedule next window from tomorrow's 7 AM
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(POSTING_START_HOUR, 0, 0, 0);
        const msUntilNext = Math.max(0, tomorrow.getTime() - Date.now());
        log(`\nWindow complete: ${count - failed} succeeded, ${failed} failed`);
        log(`Next window: ${tomorrow.toLocaleString()} (in ${(msUntilNext / 60000).toFixed(0)} min)`);
        setTimeout(planWindow, msUntilNext);
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

// Ensure music library has at least 8 tracks before starting, then kick off posting
if (cfg.pixabayMusicApiKey) {
  log("Checking music library...");
  ensureMusicLibrary(cfg.pixabayMusicApiKey, 8)
    .then(() => planWindow())
    .catch(err => {
      log(`Music library setup warning: ${err.message} — starting anyway`);
      planWindow();
    });
} else {
  log("No pixabayMusicApiKey in config — skipping music library setup");
  planWindow();
}
