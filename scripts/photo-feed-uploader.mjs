/**
 * photo-feed-uploader.mjs
 * Uploads a JPEG/PNG as an Instagram photo post to the feed.
 *
 * Exports:
 *   uploadPhotoToFeed(filePath, caption, cookieFile, profileUrl?) → Promise<boolean>
 *
 * Caption strategy: identical to reel-feed-uploader — post without a caption
 * first, then use the Edit flow (Step 9) to set it via page.keyboard.type().
 * Instagram's Edit modal uses the same contenteditable for photos and reels.
 */

import puppeteer from "puppeteer";
import fs from "fs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function log(msg) {
  console.log(`[${new Date().toISOString()}] [photo-uploader] ${msg}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Click a button ONLY in the modal header (y < 130) ─────────────────────
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

// ── Wait for share confirmation ────────────────────────────────────────────
// Returns { confirmed: boolean, postUrl: string|null }
async function waitForShareComplete(page, timeoutMs = 60000) {
  log("Waiting for share to complete...");
  const start = Date.now();

  // Wait for "Sharing" spinner first
  for (let i = 0; i < 15; i++) {
    const sharing = await page.evaluate(() =>
      document.body.innerText.includes("Sharing")
    );
    if (sharing) { log("Sharing in progress..."); break; }
    await sleep(1000);
  }

  // Then wait for confirmation
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(() => {
      const t = document.body.innerText;

      // Case 1: explicit confirmation — modal still open, scope link search to dialog
      const explicitDone =
        t.includes("Your post has been shared") ||
        t.includes("Post shared") ||
        t.includes("has been shared");

      if (explicitDone) {
        const dialog = document.querySelector('[role="dialog"]');
        const root   = dialog || document.body;
        const links  = Array.from(root.querySelectorAll("a[href]"));
        const postLink = links.find(a =>
          /\/(p|reel)\/[A-Za-z0-9_-]{5,}/.test(a.href)
        );
        return { confirmed: true, postUrl: postLink ? postLink.href : null };
      }

      // Case 2: modal closed (back on feed) — don't pick up random posts
      if (!t.includes("Sharing") && !document.querySelector('div[aria-label*="caption"]')) {
        return { confirmed: true, postUrl: null };
      }

      return null;
    });

    if (result) {
      log(`Share confirmed! Post URL: ${result.postUrl || "not found — will use profile fallback"}`);
      return result;
    }
    await sleep(1000);
  }
  log("Share confirmation timeout (post may still have succeeded)");
  return { confirmed: false, postUrl: null };
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Upload a JPEG/PNG as an Instagram photo post to the logged-in account's feed.
 *
 * @param {string} filePath   - Absolute path to image file (.jpg/.png)
 * @param {string} caption    - Caption with hashtags
 * @param {string} cookieFile - Path to saved cookies JSON
 * @param {string} profileUrl - Full Instagram profile URL (for post-then-edit caption flow)
 * @returns {Promise<boolean>}
 */
export async function uploadPhotoToFeed(filePath, caption, cookieFile, profileUrl = null) {
  if (!fs.existsSync(filePath))  throw new Error(`Image not found: ${filePath}`);
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
      const notNow = btns.find(b =>
        b.textContent.trim() === "Not Now" || b.textContent.trim() === "Not now"
      );
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
    log("Step 1: Clicking Create...");
    const createSvg = await page.$('svg[aria-label="New post"]');
    if (!createSvg) throw new Error("Create button not found — may be logged out");

    const createBox = await createSvg.boundingBox();
    await page.mouse.click(
      createBox.x + createBox.width  / 2,
      createBox.y + createBox.height / 2
    );
    await sleep(2000);
    await page.screenshot({ path: "/tmp/photo-upload-step1.png" });

    // ── Step 2: Upload the image file ─────────────────────────────────────
    // The upload dialog may show a "Select from computer" button or expose the
    // file input directly. Click "Select from computer" if visible, then attach.
    log("Step 2: Uploading image file...");

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
    await sleep(3000);
    await page.screenshot({ path: "/tmp/photo-upload-step2.png" });

    // ── Step 3: Next (Crop step) ──────────────────────────────────────────
    log("Step 3: Clicking Next past Crop step...");
    const cropOk = await clickModalButton(page, "Next", 20000);
    if (!cropOk) throw new Error("Could not click Next past Crop step");
    await sleep(2000);
    await page.screenshot({ path: "/tmp/photo-upload-step3.png" });

    // ── Step 4: Next (Filter/Edit step) ──────────────────────────────────
    log("Step 4: Clicking Next past Filter/Edit step...");
    const filterOk = await clickModalButton(page, "Next", 20000);
    if (!filterOk) {
      // Some Instagram A/B variants skip the filter step — try Share directly
      log("Filter step not found — may be skipped, will attempt Share");
    } else {
      await sleep(2000);
    }
    await page.screenshot({ path: "/tmp/photo-upload-step4.png" });

    // ── Step 5: Caption step — SKIP (applied via Edit after posting) ──────
    // Instagram's upload-flow caption field is React-controlled; DOM/keyboard
    // methods don't update React state.  We post empty and edit afterward.
    log("Step 5: Caption will be applied after posting (Step 8).");
    await sleep(1000);

    // ── Step 6: Share (publish) ───────────────────────────────────────────
    log("Step 6: Clicking Share to publish...");
    const shareOk = await clickModalButton(page, "Share", 15000);
    if (!shareOk) throw new Error("Share button not found in modal header");

    // ── Step 7: Wait for confirmation ─────────────────────────────────────
    log("Step 7: Waiting for confirmation...");
    const { confirmed, postUrl: sharedPostUrl } = await waitForShareComplete(page, 120000);
    if (confirmed) {
      log("✅ Photo posted successfully!");
    } else {
      log("Share confirmation not detected — post may still have succeeded");
    }

    const currentPageUrl = page.url();
    log(`Current URL after share: ${currentPageUrl}`);
    const directPostUrl =
      sharedPostUrl ||
      (/\/(p|reel)\/[A-Za-z0-9_-]{5,}/.test(currentPageUrl) ? currentPageUrl : null);

    await sleep(3000);
    await page.screenshot({ path: "/tmp/photo-upload-done.png" });

    // ── Step 8: Edit caption after posting ────────────────────────────────
    // The Edit modal's contenteditable responds to page.keyboard.type() because
    // it fires real browser input events that React's event system processes.
    if (caption && caption.trim().length > 0 && profileUrl) {
      log("Step 8: Editing caption via Edit flow...");
      try {
        let postPageUrl = directPostUrl;

        if (postPageUrl) {
          log(`Using post URL from share confirmation: ${postPageUrl}`);
        } else {
          // Fall back: navigate to profile, wait for the new post in the grid
          log("Navigating to profile to find latest post...");
          await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 });

          for (let attempt = 0; attempt < 5; attempt++) {
            await sleep(3000);
            postPageUrl = await page.evaluate(() => {
              const root =
                document.querySelector("main") ||
                document.querySelector('[role="main"]') ||
                document.body;
              const links = Array.from(root.querySelectorAll("a[href]"));
              const match = links.find(a =>
                /\/(p|reel)\/[A-Za-z0-9_-]{5,}/.test(a.href) &&
                a.offsetParent !== null
              );
              return match ? match.href : null;
            });
            if (postPageUrl) break;
            log(`Post not visible in grid yet, reloading... (attempt ${attempt + 1}/5)`);
            await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
          }
        }

        if (!postPageUrl) throw new Error("Could not find the new post URL to edit caption");
        log(`Navigating to post: ${postPageUrl}`);
        await page.goto(postPageUrl, { waitUntil: "networkidle2", timeout: 30000 });
        await sleep(2500);

        // Intercept API responses to confirm the save
        const apiLog = [];
        const responseHandler = (response) => {
          const url = response.url();
          if (url.includes("/api/v1/") || url.includes("graphql")) {
            apiLog.push(`${response.request().method()} ${url.replace("https://www.instagram.com", "")} → ${response.status()}`);
          }
        };
        page.on("response", responseHandler);

        // Click "..." More options
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
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll(
            "button, div[role='button'], div[role='menuitem']"
          ));
          const edit = btns.find(b =>
            b.textContent.trim() === "Edit" && b.offsetParent !== null
          );
          if (edit) edit.click();
        });
        await sleep(3000);
        await page.screenshot({ path: "/tmp/photo-edit-modal.png" });

        // Find and type into the caption contenteditable
        const captionSelector = 'div[aria-label="Write a caption..."]';
        const captionEl = await page.$(captionSelector);
        if (!captionEl) throw new Error("Caption contenteditable not found in edit modal");

        await captionEl.click();
        await sleep(300);
        await page.keyboard.down("Meta");   // Cmd+A — select all
        await page.keyboard.press("a");
        await page.keyboard.up("Meta");
        await sleep(200);
        await page.keyboard.type(caption, { delay: 15 });
        await sleep(800);

        // Verify text is in the DOM
        const captionResult = await page.evaluate((sel) => {
          const div = document.querySelector(sel);
          return div
            ? `${div.textContent.trim().length} chars: "${div.textContent.trim().slice(0, 80)}"`
            : "not found";
        }, captionSelector);
        log(`Caption entered: ${captionResult}`);
        await page.screenshot({ path: "/tmp/photo-caption-before-done.png" });

        // Click "Done" (Edit modal header, y < 150)
        const doneClicked = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll("button, div[role='button']"));
          const done = all.find(el => {
            if (el.textContent.trim() !== "Done") return false;
            const b = el.getBoundingClientRect();
            return b.y < 150 && b.width > 0 && el.offsetParent !== null;
          });
          if (done) { done.click(); return true; }
          return false;
        });
        log(`Done button clicked: ${doneClicked}`);
        await sleep(3000);

        page.off("response", responseHandler);
        for (const entry of apiLog) {
          log(`[API intercepted] ${entry}`);
        }

        await page.screenshot({ path: "/tmp/photo-caption-saved.png" });
        log("✅ Caption edit flow completed!");
      } catch (editErr) {
        log(`Caption edit failed: ${editErr.message} — post published without caption`);
        await page.screenshot({ path: "/tmp/photo-caption-error.png" }).catch(() => {});
      }
    }

    success = true;

  } finally {
    await browser.close().catch(() => {});
  }

  return success;
}
