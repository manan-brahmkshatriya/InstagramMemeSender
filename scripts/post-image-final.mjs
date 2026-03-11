/**
 * post-image-final.mjs
 * Fixed: only interacts with elements INSIDE the "Create new post" modal.
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const IMAGE_PATH = "/tmp/sunset-final.jpg";
const CAPTION = "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Click a button INSIDE the modal only (y < 900, and in the modal region)
async function clickModalButton(page, text, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked = await page.evaluate((text) => {
      // Find all buttons/divs with matching text
      const all = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button']"));
      const matches = all.filter(el => {
        if (el.textContent.trim() !== text) return false;
        if (el.offsetParent === null) return false;
        const b = el.getBoundingClientRect();
        // Must be visible, non-zero size, and in the upper portion (modal header area)
        // The modal's Next/Share button is always at the top-right, y < 130
        return b.width > 0 && b.height > 0;
      });
      // For "Next" and "Share" publish buttons, they're in the modal header (y < 130)
      // For "Share" on feed posts, they're lower (y > 300)
      const modalBtn = matches.find(el => {
        const b = el.getBoundingClientRect();
        return b.y < 130;
      });
      if (modalBtn) {
        modalBtn.click();
        const b = modalBtn.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y) };
      }
      return null;
    }, text);
    if (clicked) {
      log(`Clicked "${text}" at ${JSON.stringify(clicked)}`);
      return true;
    }
    await sleep(500);
  }
  log(`TIMEOUT: Could not find modal button "${text}"`);
  return false;
}

// Wait for a specific step by checking for elements unique to that step
async function waitForStep(page, stepName, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((step) => {
      const text = document.body.innerText;
      if (step === 'filter') {
        // Filter page has filter names
        return text.includes('Clarendon') || text.includes('Gingham') || text.includes('Valencia') || 
               !!document.querySelector('button._aswp') && !text.includes('Drag photos');
      }
      if (step === 'caption') {
        return !!document.querySelector('div[aria-label*="caption"]') || 
               text.includes('Add location') || text.includes('Write a caption');
      }
      return false;
    }, stepName);
    if (found) { log(`On ${stepName} step`); return true; }
    await sleep(500);
  }
  log(`TIMEOUT waiting for step: ${stepName}`);
  return false;
}

(async () => {
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

  // ── Step 1: Click Create ──────────────────────────────────────────────────
  log("Step 1: Clicking Create...");
  const createSvg = await page.$('svg[aria-label="New post"]');
  const createBox = await createSvg.boundingBox();
  await page.mouse.click(createBox.x + createBox.width/2, createBox.y + createBox.height/2);
  await sleep(2000);

  // ── Step 2: Click Post menu ───────────────────────────────────────────────
  log("Step 2: Clicking Post from menu...");
  const postItem = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim() === "Post") {
        const el = node.parentElement;
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.height > 0) return { x: b.x + b.width/2, y: b.y + b.height/2 };
      }
    }
    return null;
  });
  if (postItem) await page.mouse.click(postItem.x, postItem.y);
  await sleep(3000);

  // ── Step 3: Upload file ───────────────────────────────────────────────────
  log("Step 3: Uploading file...");
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) { log("No file input!"); await browser.close(); process.exit(1); }
  await fileInput.uploadFile(IMAGE_PATH);
  log("File uploaded, waiting for crop step...");
  await sleep(5000);
  await page.screenshot({ path: "/tmp/final-after-upload.png" });

  // Verify on crop step
  const onCrop = await page.evaluate(() => {
    const b = document.body.innerText;
    const modal = document.querySelector('[role="dialog"]') || document.querySelector('._aatb');
    return b.includes('Crop') || !!document.querySelector('button[class*="_aswp"]');
  });
  log("On crop step: " + onCrop);

  // ── Step 4: Crop → Next ───────────────────────────────────────────────────
  log("Step 4: Crop → Next...");
  const cropNextOk = await clickModalButton(page, "Next", 15000);
  if (!cropNextOk) {
    await page.screenshot({ path: "/tmp/final-crop-fail.png" });
    await browser.close(); process.exit(1);
  }
  
  // Wait for filter step
  const onFilter = await waitForStep(page, "filter", 15000);
  log("Filter step reached: " + onFilter);
  await page.screenshot({ path: "/tmp/final-filter.png" });

  // ── Step 5: Filter → Next ─────────────────────────────────────────────────
  log("Step 5: Filter → Next...");
  const filterNextOk = await clickModalButton(page, "Next", 15000);
  if (!filterNextOk) {
    await page.screenshot({ path: "/tmp/final-filter-fail.png" });
    await browser.close(); process.exit(1);
  }

  // Wait for caption step
  const onCaption = await waitForStep(page, "caption", 15000);
  log("Caption step reached: " + onCaption);
  await page.screenshot({ path: "/tmp/final-caption-pre.png" });

  // ── Step 6: Type caption ──────────────────────────────────────────────────
  log("Step 6: Typing caption...");
  const captionTyped = await page.evaluate((caption) => {
    const el = document.querySelector('div[aria-label*="caption"]') || document.querySelector('div[role="textbox"]');
    if (el) {
      el.focus();
      document.execCommand('insertText', false, caption);
      return true;
    }
    return false;
  }, CAPTION);
  log("Caption typed: " + captionTyped);
  await sleep(2000);
  await page.screenshot({ path: "/tmp/final-caption-post.png" });

  // ── Step 7: Share (publish) — click the modal header Share ────────────────
  log("Step 7: Clicking modal Share to publish...");
  const shareOk = await clickModalButton(page, "Share", 15000);
  if (!shareOk) {
    log("No modal Share found — taking screenshot");
    await page.screenshot({ path: "/tmp/final-share-fail.png" });
    await browser.close(); process.exit(1);
  }

  // Wait for success — modal should close and show confirmation
  log("Waiting for post confirmation...");
  await sleep(8000);
  await page.screenshot({ path: "/tmp/final-result.png" });

  const currentUrl = page.url();
  log("URL after Share: " + currentUrl);

  // Check for success text
  const successText = await page.evaluate(() => {
    return document.body.innerText.includes("Your post has been shared") || 
           document.body.innerText.includes("Post shared") ||
           !document.querySelector('div[aria-label*="caption"]'); // modal closed
  });
  log("Success check: " + successText);

  // Go to profile
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(5000);
  await page.evaluate(() => {
    document.querySelectorAll("button").forEach(b => {
      if (b.textContent.trim() === "Not Now") b.click();
    });
  });
  await sleep(1000);
  await page.screenshot({ path: "/tmp/final-profile.png" });

  const postCount = await page.evaluate(() => {
    return document.querySelector("header")?.innerText?.match(/(\d+) posts?/i)?.[1] || "unknown";
  });
  log("Profile post count: " + postCount);

  await sleep(5000);
  await browser.close();
  log("DONE");
})();
