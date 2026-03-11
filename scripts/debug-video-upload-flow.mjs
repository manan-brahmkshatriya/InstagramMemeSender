/**
 * debug-video-upload-flow.mjs
 * Uploads a video via the new Instagram Create flow and screenshots every step.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const COOKIE_FILE = path.join(PROJECT_ROOT, ".instagram-session/cookies-riseclub9.json");
const VIDEO_FILE  = "/tmp/reel-generator/pexels-26975230-1773254255435.mp4";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function dumpVisibleText(page, label) {
  await page.screenshot({ path: `/tmp/debug-flow-${label}.png` }).catch(() => {});
  const texts = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t.length === 0 || t.length > 80) continue;
      const el = node.parentElement;
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) out.push(`"${t}" at y=${Math.round(b.y)}`);
    }
    return out;
  });
  log(`\n--- [${label}] Text nodes ---`);
  texts.forEach(t => log(`  ${t}`));
}

// Check video file exists
if (!fs.existsSync(VIDEO_FILE)) {
  log("ERROR: Video file not found. Download one first.");
  process.exit(1);
}
log(`Video file found: ${VIDEO_FILE} (${(fs.statSync(VIDEO_FILE).size / 1024 / 1024).toFixed(2)} MB)`);

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

  log("Navigating to Instagram...");
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const notNow = btns.find(b => b.textContent.trim() === "Not Now" || b.textContent.trim() === "Not now");
    if (notNow) notNow.click();
  });
  await sleep(500);
  log("Logged in ✓");

  // Click Create
  const createSvg = await page.$('svg[aria-label="New post"]');
  if (!createSvg) throw new Error("Create SVG not found");
  const box = await createSvg.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(2500);
  await dumpVisibleText(page, "01-after-create-click");

  // Click "Select from computer" button
  log("\nClicking 'Select from computer'...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const sel = btns.find(b =>
      b.textContent.toLowerCase().includes("select from computer") ||
      b.textContent.toLowerCase().includes("select from device") ||
      b.textContent.toLowerCase().includes("select from")
    );
    if (sel) sel.click();
  });
  await sleep(800);

  // Find file input
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) {
    log("ERROR: file input not found. Dumping all inputs...");
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map(i => ({
        type: i.type, accept: i.accept, id: i.id, name: i.name
      }));
    });
    inputs.forEach(i => log(`  input: ${JSON.stringify(i)}`));
  } else {
    log(`File input found. Uploading: ${VIDEO_FILE}`);
    await fileInput.uploadFile(VIDEO_FILE);
    log("File upload initiated — watching for Instagram response...");
    await sleep(3000);
    await dumpVisibleText(page, "02-after-upload");

    // Poll every 5 seconds for up to 90 seconds
    for (let i = 0; i < 18; i++) {
      await sleep(5000);
      const label = `03-poll-${(i+1)*5}s`;
      await dumpVisibleText(page, label);

      const state = await page.evaluate(() => {
        const body = document.body.innerText;
        // Check for all relevant keywords
        const hasReel = body.includes("Reel") || body.includes("reel");
        const hasNext = (() => {
          const all = Array.from(document.querySelectorAll("button, div[role='button']"));
          return all.some(el => {
            if (el.textContent.trim() !== "Next") return false;
            const b = el.getBoundingClientRect();
            return b.y < 150 && b.width > 0;
          });
        })();
        const hasShare = body.includes("Share");
        const hasCaption = body.includes("caption") || body.includes("Caption");
        const hasPost = body.includes("Post to") || body.includes("Create post");
        return { hasReel, hasNext, hasShare, hasCaption, hasPost, bodySnippet: body.substring(0, 200) };
      });

      log(`Poll ${(i+1)*5}s: reel=${state.hasReel} next=${state.hasNext} share=${state.hasShare} caption=${state.hasCaption} post=${state.hasPost}`);
      log(`  Body snippet: ${state.bodySnippet.replace(/\n/g, ' ').substring(0, 100)}`);

      if (state.hasNext || state.hasCaption) {
        log(">>> Found actionable Next/Caption! Stopping poll.");
        break;
      }
    }
  }

  log("\nKeeping browser open for 30s...");
  await sleep(30000);

} catch (err) {
  log(`ERROR: ${err.message}`);
  console.error(err);
} finally {
  await browser.close().catch(() => {});
}
