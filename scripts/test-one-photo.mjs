/**
 * test-one-photo.mjs
 * End-to-end test: generate a motivational quote image and post it to Instagram.
 *
 * Usage:  node scripts/test-one-photo.mjs
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createQuoteImage } from "./photo-quote-generator.mjs";
import { uploadPhotoToFeed } from "./photo-feed-uploader.mjs";
import { MOTIVATIONAL_QUOTES } from "./quotes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../.reel-generator-config.json");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Load config ────────────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const PROFILE_URL = `https://www.instagram.com/${config.account}/`;
const COOKIE_FILE = config.cookieFile;

// ── Pick a quote ───────────────────────────────────────────────────────────
// Use a fixed index for reproducibility in testing
const quote = MOTIVATIONAL_QUOTES[42]; // "One focused hour beats ten distracted ones."

// ── Build caption ──────────────────────────────────────────────────────────
const caption = `${quote} 💡\n\n` +
  `#motivation #motivationalquotes #mindset #success #growth ` +
  `#inspire #hustle #believe #quotes #instadaily ` +
  `#quoteoftheday #dailymotivation #positivemindset #goalsetter #winning`;

// ── Output path ────────────────────────────────────────────────────────────
const OUTDIR = "/tmp/reel-generator";
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
const imgPath = path.join(OUTDIR, `quote-test-${Date.now()}.jpg`);

log("============================================================");
log("TEST: One-off Photo post to " + config.account);
log(`Quote:   ${quote}`);
log(`Caption: ${caption}`);
log("============================================================\n");

try {
  // Step 1: Generate the quote image
  log("Step 1: Generating quote image...");
  createQuoteImage(quote, imgPath);
  log(`✅ Image created → ${imgPath}\n`);

  // Step 2: Upload to Instagram
  log("Step 2: Uploading to Instagram as Photo post...");
  const uploadOk = await uploadPhotoToFeed(imgPath, caption, COOKIE_FILE, PROFILE_URL);

  if (uploadOk) {
    log("\n✅ TEST PASSED — Photo with quote posted successfully!");
  } else {
    log("\n❌ TEST FAILED — uploadPhotoToFeed returned false");
    process.exit(1);
  }
} catch (err) {
  log(`\n❌ TEST ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
} finally {
  // Clean up temp image
  if (fs.existsSync(imgPath)) {
    fs.unlinkSync(imgPath);
    log(`Cleaned up: ${imgPath}`);
  }
}
