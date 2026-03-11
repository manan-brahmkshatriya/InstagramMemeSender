/**
 * post-image.mjs
 * Posts a single image to the Instagram feed for the logged-in account.
 * Usage: node scripts/post-image.mjs <imagePath> [caption]
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IMAGE_PATH = process.argv[2] || "/tmp/sunset-final.jpg";
const CAPTION    = process.argv[3] || "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";

const SESSION_DIR  = path.join(__dirname, "../.instagram-session");
const COOKIE_FILE  = path.join(SESSION_DIR, "cookies.json");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Load saved cookies
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    await page.setCookie(...cookies);
    log(`Loaded ${cookies.length} cookies`);
  } else {
    log("No cookie file found — please run manual-login.mjs first");
    await browser.close();
    process.exit(1);
  }

  // Navigate to Instagram
  log("Navigating to Instagram...");
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Check we are logged in
  const url = page.url();
  if (url.includes("/accounts/login")) {
    log("ERROR: Not logged in. Please run manual-login.mjs to refresh cookies.");
    await browser.close();
    process.exit(1);
  }
  log("Logged in successfully. Current URL: " + url);

  // ── Step 1: Click the Create / New Post button ───────────────────────────
  log("Looking for Create (new post) button...");
  await sleep(2000);

  // Try the SVG aria-label approach first
  let createBtn = await page.$('svg[aria-label="New post"]');
  if (createBtn) {
    const parent = await createBtn.evaluateHandle(el => {
      let node = el;
      while (node && node.tagName !== "A" && node.tagName !== "BUTTON" && node.getAttribute("role") !== "button") {
        node = node.parentElement;
      }
      return node;
    });
    await parent.click();
    log("Clicked Create button via SVG parent");
  } else {
    // Fallback: look for the + icon / Create link in the nav
    const links = await page.$$('a[href="/create/style/"]');
    if (links.length > 0) {
      await links[0].click();
      log("Clicked create link");
    } else {
      log("Trying to find create button by text...");
      await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const createSpan = spans.find(s => s.textContent.trim() === "Create");
        if (createSpan) {
          let node = createSpan;
          while (node && node.tagName !== "A" && node.tagName !== "BUTTON" && node.getAttribute("role") !== "button") {
            node = node.parentElement;
          }
          if (node) node.click();
        }
      });
      log("Clicked Create via text search");
    }
  }

  await sleep(2000);

  // ── Step 2: Click "Post" from the dropdown menu ──────────────────────────
  log("Looking for Post option in menu...");
  const postOption = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll("span"));
    const s = spans.find(el => el.textContent.trim() === "Post");
    if (!s) return false;
    let node = s;
    while (node && node.tagName !== "A" && node.tagName !== "BUTTON" && node.getAttribute("role") !== "button") {
      node = node.parentElement;
    }
    if (node) { node.click(); return true; }
    return false;
  });

  if (postOption) {
    log("Clicked Post menu item");
  } else {
    log("Post menu item not found — might have gone directly to upload dialog");
  }

  await sleep(2000);

  // ── Step 3: Upload the image file ────────────────────────────────────────
  log(`Uploading image: ${IMAGE_PATH}`);

  // Find the file input
  let fileInput = await page.$('input[type="file"]');
  if (!fileInput) {
    // Try clicking the "Select from computer" button first
    const selectBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const b = btns.find(el => el.textContent.includes("Select from computer") || el.textContent.includes("Select From Computer"));
      if (b) { b.click(); return true; }
      return false;
    });
    if (selectBtn) {
      log("Clicked 'Select from computer'");
      await sleep(1000);
      fileInput = await page.$('input[type="file"]');
    }
  }

  if (!fileInput) {
    log("ERROR: Could not find file input. Taking screenshot...");
    await page.screenshot({ path: "/tmp/post-debug.png" });
    log("Screenshot saved to /tmp/post-debug.png");
    await browser.close();
    process.exit(1);
  }

  await fileInput.uploadFile(IMAGE_PATH);
  log("File uploaded. Waiting for preview...");
  await sleep(4000);

  // ── Step 4: Handle "Crop" step — click Next ───────────────────────────────
  log("Looking for Next button (crop step)...");
  let nextClicked = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    nextClicked = await page.evaluate(() => {
      // Look for Next button in the modal header
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const nextBtn = btns.find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (nextBtn) { nextBtn.click(); return true; }
      return false;
    });
    if (nextClicked) {
      log("Clicked Next (crop step)");
      break;
    }
    await sleep(1000);
  }

  if (!nextClicked) {
    log("WARNING: Could not click Next on crop step");
    await page.screenshot({ path: "/tmp/post-debug-crop.png" });
  }

  await sleep(3000);

  // ── Step 5: Handle "Filter" step — click Next ────────────────────────────
  log("Looking for Next button (filter/edit step)...");
  nextClicked = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    nextClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const nextBtn = btns.find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (nextBtn) { nextBtn.click(); return true; }
      return false;
    });
    if (nextClicked) {
      log("Clicked Next (filter step)");
      break;
    }
    await sleep(1000);
  }

  await sleep(3000);

  // ── Step 6: Add caption ───────────────────────────────────────────────────
  log("Looking for caption field...");
  const captionAdded = await page.evaluate((caption) => {
    // The caption textarea / contenteditable
    const textareas = Array.from(document.querySelectorAll("textarea, div[contenteditable='true'], div[aria-label='Write a caption...'], div[aria-label='Write a caption…']"));
    if (textareas.length > 0) {
      const ta = textareas[0];
      ta.focus();
      // Use execCommand to insert text so React picks it up
      document.execCommand("insertText", false, caption);
      return true;
    }
    return false;
  }, CAPTION);

  if (captionAdded) {
    log(`Caption added: ${CAPTION}`);
  } else {
    log("WARNING: Could not find caption field");
    await page.screenshot({ path: "/tmp/post-debug-caption.png" });
  }

  await sleep(2000);

  // ── Step 7: Click Share ───────────────────────────────────────────────────
  log("Looking for Share button...");
  let shareClicked = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    shareClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const shareBtn = btns.find(el => (el.textContent.trim() === "Share" || el.textContent.trim() === "Post") && el.offsetParent !== null);
      if (shareBtn) { shareBtn.click(); return true; }
      return false;
    });
    if (shareClicked) {
      log("Clicked Share button!");
      break;
    }
    await sleep(1000);
  }

  if (!shareClicked) {
    log("ERROR: Could not find Share button");
    await page.screenshot({ path: "/tmp/post-debug-share.png" });
    await sleep(10000);
    await browser.close();
    process.exit(1);
  }

  // ── Step 8: Wait for confirmation ────────────────────────────────────────
  log("Waiting for post confirmation...");
  await sleep(8000);

  // Check for success
  const success = await page.evaluate(() => {
    // Instagram shows "Your post has been shared." or navigates away
    const text = document.body.innerText;
    return text.includes("Your post has been shared") || text.includes("Post shared");
  });

  if (success) {
    log("✅ Post shared successfully!");
  } else {
    log("Checking current URL for success...");
    const finalUrl = page.url();
    log("Final URL: " + finalUrl);
    await page.screenshot({ path: "/tmp/post-final.png" });
    log("Final screenshot saved to /tmp/post-final.png");
  }

  await sleep(3000);
  await browser.close();
  log("Done.");
})();
