/**
 * post-image-v2.mjs — More robust Instagram image post with step verification.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const IMAGE_PATH  = process.argv[2] || "/tmp/sunset-final.jpg";
const CAPTION     = process.argv[3] || "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForButton(page, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate((label) => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button']"));
      const b = btns.find(el => el.textContent.trim() === label && el.offsetParent !== null && !el.disabled);
      if (b) { b.click(); return true; }
      return false;
    }, label);
    if (found) return true;
    await sleep(800);
  }
  return false;
}

(async () => {
  log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);

  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // ── Dismiss any dialogs ───────────────────────────────────────────────────
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const notNow = btns.find(b => b.textContent.trim() === "Not Now" || b.textContent.trim() === "Not now");
    if (notNow) notNow.click();
  });
  await sleep(1000);

  // ── Step 1: Click Create button ───────────────────────────────────────────
  log("Step 1: Finding Create button...");
  await page.screenshot({ path: "/tmp/step1.png" });

  const createClicked = await page.evaluate(() => {
    // Try SVG aria-label
    const svg = document.querySelector('svg[aria-label="New post"]');
    if (svg) {
      let node = svg;
      for (let i = 0; i < 8; i++) {
        node = node.parentElement;
        if (!node) break;
        const tag = node.tagName?.toUpperCase();
        const role = node.getAttribute?.("role");
        if (tag === "A" || tag === "BUTTON" || role === "button" || role === "link") {
          node.click();
          return "svg-parent";
        }
      }
    }
    // Fallback: find by "Create" text in nav
    const spans = Array.from(document.querySelectorAll("span"));
    const s = spans.find(el => el.textContent.trim() === "Create" && el.closest('nav, aside'));
    if (s) {
      let node = s;
      for (let i = 0; i < 8; i++) {
        node = node.parentElement;
        if (!node) break;
        const tag = node.tagName?.toUpperCase();
        const role = node.getAttribute?.("role");
        if (tag === "A" || tag === "BUTTON" || role === "button") {
          node.click();
          return "text";
        }
      }
    }
    return null;
  });
  log(`Create button clicked via: ${createClicked}`);
  await sleep(2500);
  await page.screenshot({ path: "/tmp/step1-after.png" });

  // ── Step 2: Click "Post" ──────────────────────────────────────────────────
  log("Step 2: Clicking 'Post' option...");
  const postClicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("button, a, div[role='button'], div[role='menuitem']"));
    const b = items.find(el => el.textContent.trim() === "Post" && el.offsetParent !== null);
    if (b) { b.click(); return true; }
    return false;
  });
  if (postClicked) log("Post menu item clicked");
  await sleep(2500);
  await page.screenshot({ path: "/tmp/step2.png" });

  // ── Step 3: Find file input and upload ────────────────────────────────────
  log("Step 3: Uploading file...");

  // Click "Select from computer" if present
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const b = btns.find(el => el.textContent.toLowerCase().includes("select from computer"));
    if (b) b.click();
  });
  await sleep(1000);

  let fileInput = await page.$('input[type="file"]');
  if (!fileInput) {
    log("No file input found. Screenshot saved.");
    await page.screenshot({ path: "/tmp/step3-no-input.png" });
    await browser.close();
    process.exit(1);
  }

  await fileInput.uploadFile(IMAGE_PATH);
  log(`Uploaded: ${IMAGE_PATH}`);
  await sleep(5000);
  await page.screenshot({ path: "/tmp/step3-after.png" });

  // ── Step 4: Crop step — click Next ────────────────────────────────────────
  log("Step 4: Crop → Next...");
  const cropNext = await waitForButton(page, "Next", 15000);
  if (cropNext) { log("Crop Next clicked"); } else { log("WARNING: Crop Next not found"); }
  await sleep(3000);
  await page.screenshot({ path: "/tmp/step4-after.png" });

  // ── Step 5: Filter step — click Next ─────────────────────────────────────
  log("Step 5: Filter → Next...");
  const filterNext = await waitForButton(page, "Next", 15000);
  if (filterNext) { log("Filter Next clicked"); } else { log("WARNING: Filter Next not found"); }
  await sleep(3000);
  await page.screenshot({ path: "/tmp/step5-after.png" });

  // ── Step 6: Caption step — verify we're on caption page ──────────────────
  log("Step 6: Adding caption...");
  await page.screenshot({ path: "/tmp/step6-caption.png" });

  const captionAdded = await page.evaluate((caption) => {
    const selectors = [
      'div[aria-label="Write a caption..."]',
      'div[aria-label="Write a caption…"]',
      'textarea[aria-label="Write a caption..."]',
      'div[role="textbox"]',
      'textarea',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        el.focus();
        document.execCommand("insertText", false, caption);
        return sel;
      }
    }
    return null;
  }, CAPTION);
  log(`Caption added via: ${captionAdded}`);
  await sleep(2000);

  // ── Step 7: Share / Publish ───────────────────────────────────────────────
  log("Step 7: Clicking Share to publish...");
  await page.screenshot({ path: "/tmp/step7-before-share.png" });

  // Target the Share button that's in the modal header (top-right of dialog)
  const shareClicked = await page.evaluate(() => {
    // Look for the modal/dialog header Share button specifically
    const dialogs = document.querySelectorAll('div[role="dialog"], div[class*="modal"]');
    for (const dialog of dialogs) {
      const btns = Array.from(dialog.querySelectorAll("button, div[role='button']"));
      const share = btns.find(b => b.textContent.trim() === "Share" && b.offsetParent !== null);
      if (share) { share.click(); return "dialog-share"; }
    }
    // Fallback: any visible Share button
    const allBtns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const share = allBtns.find(b => b.textContent.trim() === "Share" && b.offsetParent !== null);
    if (share) { share.click(); return "fallback-share"; }
    return null;
  });
  log(`Share clicked via: ${shareClicked}`);

  if (!shareClicked) {
    log("ERROR: Share button not found!");
    await page.screenshot({ path: "/tmp/step7-no-share.png" });
    await sleep(15000);
    await browser.close();
    process.exit(1);
  }

  // ── Step 8: Wait for success ──────────────────────────────────────────────
  log("Step 8: Waiting for confirmation...");
  await sleep(8000);
  await page.screenshot({ path: "/tmp/step8-result.png" });

  const result = await page.evaluate(() => {
    const body = document.body.innerText;
    if (body.includes("Your post has been shared") || body.includes("Post shared")) return "success-text";
    return page?.url?.() || window.location.href;
  });
  log(`Result: ${result}`);

  // Navigate to profile to confirm
  log("Navigating to profile to confirm...");
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(4000);
  await page.screenshot({ path: "/tmp/profile-final.png" });

  const postCount = await page.evaluate(() => {
    // Find post count in profile header
    const statItems = document.querySelectorAll('li span, li strong');
    for (const el of statItems) {
      const num = parseInt(el.textContent.replace(/,/g, ''), 10);
      if (!isNaN(num) && num > 10 && num < 10000) {
        const li = el.closest('li');
        if (li && (li.textContent.includes('post') || li.textContent.includes('Post'))) return num;
      }
    }
    return null;
  });
  log(`Profile post count: ${postCount}`);

  log("✅ Done! Check /tmp/step8-result.png and /tmp/profile-final.png");
  await sleep(5000);
  await browser.close();
})();
