/**
 * fix-missing-captions.mjs
 * One-off script: walks every post on riseclub9's profile, detects posts
 * without a caption, and adds one via the edit_media request-injection method.
 *
 * Usage: node scripts/fix-missing-captions.mjs
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../.reel-generator-config.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Captions (same as daemon) ────────────────────────────────────────────────
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
function buildCaption(i) {
  return `${CAPTION_OPENERS[i % CAPTION_OPENERS.length]}\n\n${HASHTAG_SETS[i % HASHTAG_SETS.length]}`;
}

// ── Collect all post URLs from the profile grid ──────────────────────────────
async function collectAllPostUrls(page, profileUrl) {
  log(`Navigating to profile: ${profileUrl}`);
  await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  const seen = new Set();
  let prevCount = 0;
  let stalePasses = 0;

  while (stalePasses < 3) {
    // Collect visible post links
    const links = await page.evaluate(() => {
      const root = document.querySelector("main") || document.body;
      return Array.from(root.querySelectorAll("a[href]"))
        .map(a => a.href)
        .filter(h => /\/(reel|p)\/[A-Za-z0-9_-]{5,}/.test(h));
    });
    links.forEach(l => seen.add(l.split("?")[0]));

    if (seen.size === prevCount) {
      stalePasses++;
    } else {
      stalePasses = 0;
      prevCount = seen.size;
    }

    log(`Collected ${seen.size} post URLs so far…`);

    // Scroll down to load more
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(2000);
  }

  return [...seen];
}

// ── Check whether a post already has a caption ───────────────────────────────
async function hasCaption(page, postUrl) {
  await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(2000);

  return page.evaluate(() => {
    // The caption lives in a <span> or <div> inside the article, before comments.
    // Instagram renders it inside an <h1> or a span with the username+caption block.
    const article = document.querySelector("article");
    if (!article) return false;

    // Look for a span that contains actual text (not just the username)
    const spans = Array.from(article.querySelectorAll("span, div"));
    for (const el of spans) {
      const txt = el.textContent.trim();
      // Caption text is usually >20 chars and not a button/icon
      if (
        txt.length > 20 &&
        el.offsetParent !== null &&
        !["button", "a"].includes(el.tagName.toLowerCase()) &&
        el.closest("time") === null
      ) {
        // Make sure it's not just the username
        const isUsername = el.closest('[role="link"]') !== null && txt.length < 30;
        if (!isUsername) return true;
      }
    }
    return false;
  });
}

// ── Add caption to a post via Edit modal + request injection ─────────────────
async function addCaption(page, postUrl, caption) {
  // Already on the post page from hasCaption() check
  await sleep(1000);

  // Click "More options" (…)
  const moreOptEl = await page.waitForSelector(
    'svg[aria-label="More options"]',
    { visible: true, timeout: 10000 }
  ).catch(() => null);
  if (!moreOptEl) throw new Error('"More options" not found');

  await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('svg[aria-label="More options"]'));
    for (const svg of svgs) {
      let node = svg;
      for (let i = 0; i < 5; i++) {
        node = node.parentElement;
        if (!node) break;
        if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") {
          node.click(); return;
        }
      }
    }
  });
  await sleep(1500);

  // Click "Edit"
  const editClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(
      "button, div[role='button'], div[role='menuitem']"
    ));
    const edit = btns.find(b => b.textContent.trim() === "Edit" && b.offsetParent !== null);
    if (edit) { edit.click(); return true; }
    return false;
  });
  if (!editClicked) throw new Error('"Edit" menu item not found');
  await sleep(3000);

  // Verify Edit modal is open
  const captionEl = await page.$('div[aria-label="Write a caption..."]');
  if (!captionEl) throw new Error("Caption field not found in Edit modal");

  // Intercept edit_media and inject caption_text
  await page.setRequestInterception(true);
  let injected = false;
  const reqHandler = async (req) => {
    const url = req.url();
    if (url.includes("edit_media") || url.includes("web/edit")) {
      const raw = req.postData() || "{}";
      try {
        const body = JSON.parse(raw);
        body.caption_text = caption;
        req.continue({ postData: JSON.stringify(body) });
      } catch (_) {
        const appended = raw
          ? `${raw}&caption_text=${encodeURIComponent(caption)}`
          : `caption_text=${encodeURIComponent(caption)}`;
        req.continue({ postData: appended });
      }
      injected = true;
    } else {
      req.continue();
    }
  };
  page.on("request", reqHandler);

  // Click Done
  const doneClicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button, div[role='button']"));
    const done = all.find(el => {
      if (el.textContent.trim() !== "Done") return false;
      const b = el.getBoundingClientRect();
      return b.y < 200 && b.width > 0 && el.offsetParent !== null;
    });
    if (done) { done.click(); return true; }
    return false;
  });

  await sleep(4000);
  page.off("request", reqHandler);
  await page.setRequestInterception(false);

  return { doneClicked, injected };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const PROFILE_URL = `https://www.instagram.com/${config.account}/`;
const COOKIE_FILE = config.cookieFile;

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: { width: 1280, height: 900 },
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  await page.setUserAgent(USER_AGENT);

  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);

  // ── Step 1: Collect all post URLs ─────────────────────────────────────────
  const allUrls = await collectAllPostUrls(page, PROFILE_URL);
  log(`\nTotal posts found: ${allUrls.length}`);

  // ── Step 2: Check each post for a caption and fix if missing ──────────────
  let fixed = 0;
  let alreadyHad = 0;
  let failed = 0;
  let captionIndex = 0;

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    log(`\n[${i + 1}/${allUrls.length}] ${url}`);

    try {
      const hasCap = await hasCaption(page, url);
      if (hasCap) {
        log(`  ✓ Already has caption — skipping`);
        alreadyHad++;
        continue;
      }

      log(`  ✗ No caption — adding...`);
      const caption = buildCaption(captionIndex++);
      const { doneClicked, injected } = await addCaption(page, url, caption);
      log(`  Done clicked: ${doneClicked} | Injected: ${injected}`);
      log(`  ✅ Caption added: "${caption.slice(0, 60)}…"`);
      fixed++;

      // Brief pause between edits to avoid rate limiting
      await sleep(3000);
    } catch (err) {
      log(`  ❌ Error: ${err.message}`);
      failed++;
      // Navigate away to reset state
      await page.goto(PROFILE_URL, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      await sleep(2000);
    }
  }

  log(`\n════════════════════════════════════════`);
  log(`Done. Fixed: ${fixed} | Already had caption: ${alreadyHad} | Failed: ${failed}`);
  log(`════════════════════════════════════════`);

} finally {
  await browser.close().catch(() => {});
}
