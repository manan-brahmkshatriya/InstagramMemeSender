/**
 * reel-feed-uploader.mjs
 * Uploads an MP4 file as an Instagram Reel to the feed (not DMs).
 *
 * Exports:
 *   uploadReelToFeed(filePath, caption, cookieFile) → Promise<boolean>
 */

import puppeteer from "puppeteer";
import fs from "fs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function log(msg) {
  console.log(`[${new Date().toISOString()}] [reel-uploader] ${msg}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Click a button ONLY inside the modal header (y < 130) ─────────────────
// Avoids clicking feed-level "Share/Like/Comment" buttons in the background.
async function clickModalButton(page, text, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate((text) => {
      const all = Array.from(
        document.querySelectorAll("button, div[role='button'], a[role='button']")
      );
      const btn = all.find(el => {
        if (el.textContent.trim() !== text) return false;
        if (el.offsetParent === null) return false;
        const b = el.getBoundingClientRect();
        return b.y < 130 && b.width > 0 && b.height > 0;
      });
      if (btn) {
        btn.click();
        const b = btn.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y) };
      }
      return null;
    }, text);

    if (result) {
      log(`Clicked "${text}" at (${result.x}, ${result.y})`);
      return true;
    }
    await sleep(500);
  }
  log(`TIMEOUT: Modal button "${text}" not found after ${timeoutMs}ms`);
  return false;
}

// ── Wait for Instagram to finish processing the uploaded video ─────────────
// The "Next" button in the modal header is disabled (aria-disabled="true")
// while the server processes the video. This polls until it becomes active.
async function waitForVideoProcessed(page, timeoutMs = 120000) {
  log("Waiting for video processing...");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const all = Array.from(
        document.querySelectorAll("button, div[role='button'], a[role='button']")
      );
      const nextBtn = all.find(el => {
        if (el.textContent.trim() !== "Next") return false;
        const b = el.getBoundingClientRect();
        return b.y < 130 && b.width > 0 && el.offsetParent !== null;
      });

      if (!nextBtn) return { found: false, ready: false };

      const disabled =
        nextBtn.getAttribute("aria-disabled") === "true" ||
        nextBtn.hasAttribute("disabled") ||
        nextBtn.style.opacity === "0.3";

      return { found: true, ready: !disabled };
    });

    if (state.ready) {
      log(`Video processed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
      return true;
    }

    // Check for error messages
    const hasError = await page.evaluate(() => {
      const t = document.body.innerText;
      return (
        t.includes("Something went wrong") ||
        t.includes("couldn't be uploaded") ||
        t.includes("video format") ||
        t.includes("file type")
      );
    });
    if (hasError) {
      log("ERROR: Instagram reported an upload error");
      return false;
    }

    await sleep(2000);
  }
  log("TIMEOUT: Video processing did not complete");
  return false;
}

// ── Wait for "Sharing" spinner and then confirmation ──────────────────────
async function waitForShareComplete(page, timeoutMs = 60000) {
  log("Waiting for share to complete...");
  const start = Date.now();

  // First wait for "Sharing" spinner to appear (indicates server upload started)
  let sharingStarted = false;
  for (let i = 0; i < 15; i++) {
    const sharing = await page.evaluate(() =>
      document.body.innerText.includes("Sharing")
    );
    if (sharing) { sharingStarted = true; log("Sharing in progress..."); break; }
    await sleep(1000);
  }

  // Then wait for it to finish
  while (Date.now() - start < timeoutMs) {
    const done = await page.evaluate(() => {
      const t = document.body.innerText;
      return (
        t.includes("Your reel has been shared") ||
        t.includes("Reel shared") ||
        t.includes("has been shared") ||
        (!t.includes("Sharing") &&
          !document.querySelector('div[aria-label*="caption"]'))
      );
    });
    if (done) { log("Share confirmed!"); return true; }
    await sleep(1000);
  }
  log("Share confirmation timeout (post may still have succeeded)");
  return false;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Upload an MP4 as an Instagram Reel to the logged-in account's feed.
 *
 * @param {string} filePath   - Absolute path to .mp4 file
 * @param {string} caption    - Caption with hashtags
 * @param {string} cookieFile - Path to saved cookies JSON
 * @returns {Promise<boolean>}
 */
export async function uploadReelToFeed(filePath, caption, cookieFile) {
  if (!fs.existsSync(filePath))  throw new Error(`Video not found: ${filePath}`);
  if (!fs.existsSync(cookieFile)) throw new Error(`Cookie file not found: ${cookieFile}`);

  log(`Uploading: ${filePath}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  let success = false;

  try {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.setUserAgent(USER_AGENT);

    // Load cookies
    const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
    await page.setCookie(...cookies);

    // ── Navigate to Instagram ─────────────────────────────────────────────
    log("Navigating to Instagram...");
    await page.goto("https://www.instagram.com/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await sleep(3000);

    // Dismiss "Turn on Notifications" popup if present
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const notNow = btns.find(b => b.textContent.trim() === "Not Now" || b.textContent.trim() === "Not now");
      if (notNow) notNow.click();
    });
    await sleep(500);

    // Verify login
    const loggedIn = await page.evaluate(() =>
      !document.URL.includes("/accounts/login")
    );
    if (!loggedIn) throw new Error("Not logged in — please refresh cookies");
    log("Logged in ✓");

    // ── Step 1: Click Create (New post) button ────────────────────────────
    // Instagram now opens a direct upload dialog (no Post/Reel/Story dropdown)
    log("Step 1: Clicking Create...");
    const createSvg = await page.$('svg[aria-label="New post"]');
    if (!createSvg) throw new Error("Create button not found — may be logged out");

    const createBox = await createSvg.boundingBox();
    await page.mouse.click(
      createBox.x + createBox.width  / 2,
      createBox.y + createBox.height / 2
    );
    await sleep(2000);
    await page.screenshot({ path: "/tmp/reel-upload-step1.png" });

    // ── Step 2: Upload the video file ─────────────────────────────────────
    // "Create new post" modal opens directly — click "Select from computer"
    log("Step 2: Uploading video file...");

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const sel = btns.find(b =>
        b.textContent.toLowerCase().includes("select from computer") ||
        b.textContent.toLowerCase().includes("select from device") ||
        b.textContent.toLowerCase().includes("select from")
      );
      if (sel) sel.click();
    });
    await sleep(500);

    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) throw new Error("File input not found in upload modal");

    await fileInput.uploadFile(filePath);
    log(`File upload initiated: ${filePath}`);
    await sleep(2500);
    await page.screenshot({ path: "/tmp/reel-upload-step2.png" });

    // ── Step 3: Dismiss "Video posts are now shared as reels" popup ───────
    // Instagram shows an info popup after video upload — click "OK" to dismiss
    log("Step 3: Dismissing video-as-reels info popup (if present)...");
    const dismissedPopup = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("button, div[role='button']"));
      const okBtn = all.find(el => {
        const t = el.textContent.trim();
        return (t === "OK" || t === "Ok") && el.offsetParent !== null;
      });
      if (okBtn) { okBtn.click(); return true; }
      return false;
    });
    if (dismissedPopup) {
      log("Dismissed 'Video posts are now shared as reels' popup ✓");
      await sleep(1000);
    }

    // ── Step 4: Wait for video processing ────────────────────────────────
    log("Step 4: Waiting for Instagram to process video...");
    const processed = await waitForVideoProcessed(page, 120000);
    if (!processed) throw new Error("Video processing failed or timed out");
    await sleep(1000);
    await page.screenshot({ path: "/tmp/reel-upload-step4.png" });

    // ── Step 5: Next (past trim/edit step) ────────────────────────────────
    log("Step 5: Clicking Next (past edit/trim step)...");
    const editOk = await clickModalButton(page, "Next", 20000);
    if (!editOk) throw new Error("Could not click Next past edit step");
    await sleep(2000);

    // ── Step 6: Extra Next step (audio/cover — Instagram A/B variation) ───
    log("Step 6: Checking for extra Next step...");
    const extraOk = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("button, div[role='button']"));
      const btn = all.find(el => {
        if (el.textContent.trim() !== "Next") return false;
        const b = el.getBoundingClientRect();
        return b.y < 130 && b.width > 0 &&
               el.getAttribute("aria-disabled") !== "true" &&
               el.offsetParent !== null;
      });
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (extraOk) {
      log("Clicked extra Next step");
      await sleep(2000);
    }
    await page.screenshot({ path: "/tmp/reel-upload-step6.png" });

    // ── Step 7: Type caption ──────────────────────────────────────────────
    log("Step 7: Typing caption...");

    // Wait for caption step
    await page.waitForFunction(
      () =>
        !!document.querySelector('div[aria-label*="caption"]') ||
        !!document.querySelector('div[aria-label*="Caption"]') ||
        document.body.innerText.includes("Write a caption"),
      { timeout: 20000 }
    ).catch(() => {});

    const captionOk = await page.evaluate((captionText) => {
      const el =
        document.querySelector('div[aria-label*="caption"]') ||
        document.querySelector('div[aria-label*="Caption"]') ||
        document.querySelector('div[role="textbox"]');
      if (!el) return false;
      el.focus();
      document.execCommand("insertText", false, captionText);
      return true;
    }, caption);

    if (!captionOk) {
      log("Warning: caption field not found — continuing without caption");
    } else {
      log("Caption typed ✓");
    }
    await sleep(2000);
    await page.screenshot({ path: "/tmp/reel-upload-step7.png" });

    // ── Step 8: Share (publish) ───────────────────────────────────────────
    log("Step 8: Clicking Share to publish...");
    const shareOk = await clickModalButton(page, "Share", 15000);
    if (!shareOk) throw new Error("Share button not found in modal header");

    // ── Step 9: Wait for confirmation ─────────────────────────────────────
    log("Step 9: Waiting for confirmation...");
    const confirmed = await waitForShareComplete(page, 120000);
    if (confirmed) {
      log("✅ Reel posted successfully!");
    } else {
      log("Share confirmation not detected — post may still have succeeded");
    }

    await sleep(3000);
    await page.screenshot({ path: "/tmp/reel-upload-done.png" });
    success = true;

  } finally {
    await browser.close().catch(() => {});
  }

  return success;
}
