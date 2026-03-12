/**
 * reel-feed-uploader.mjs
 * Uploads an MP4 file as an Instagram Reel to the feed (not DMs).
 *
 * Exports:
 *   uploadReelToFeed(filePath, caption, cookieFile, profileUrl?) → Promise<boolean>
 *
 * Caption strategy: Post the reel first (Steps 8-9), then navigate to the new
 * post and apply the caption via the Edit flow (Step 10). The Edit modal's
 * caption field is a contenteditable div — we type into it using
 * page.keyboard.type() which fires real browser input events that React's
 * state machine responds to (unlike execCommand or CDP insertText).
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
// Returns { confirmed: boolean, postUrl: string|null }
// postUrl is set when Instagram shows a "View post" link in the confirmation.
async function waitForShareComplete(page, timeoutMs = 60000) {
  log("Waiting for share to complete...");
  const start = Date.now();

  // First wait for "Sharing" spinner to appear (indicates server upload started)
  for (let i = 0; i < 15; i++) {
    const sharing = await page.evaluate(() =>
      document.body.innerText.includes("Sharing")
    );
    if (sharing) { log("Sharing in progress..."); break; }
    await sleep(1000);
  }

  // Then wait for it to finish
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(() => {
      const t = document.body.innerText;

      // Case 1: explicit "shared" message — the upload dialog is still open/visible.
      // Look for the "View post" link ONLY inside the dialog so we don't accidentally
      // pick up random posts from the feed that's loading in the background.
      const explicitDone =
        t.includes("Your reel has been shared") ||
        t.includes("Reel shared") ||
        t.includes("has been shared");

      if (explicitDone) {
        const dialog = document.querySelector('[role="dialog"]');
        const root   = dialog || document.body;
        const links  = Array.from(root.querySelectorAll("a[href]"));
        const postLink = links.find(a =>
          /\/(reel|p)\/[A-Za-z0-9_-]{5,}/.test(a.href)
        );
        return { confirmed: true, postUrl: postLink ? postLink.href : null };
      }

      // Case 2: modal already closed (back on the feed).
      // Do NOT scan for links here — they would be someone else's posts.
      // Return postUrl: null so Step 10 falls back to the profile-grid search.
      if (!t.includes("Sharing") && !document.querySelector('div[aria-label*="caption"]')) {
        return { confirmed: true, postUrl: null };
      }

      return null;
    });

    if (result) {
      log(`Share confirmed! New post URL: ${result.postUrl || "not found — will use profile fallback"}`);
      return result;
    }
    await sleep(1000);
  }
  log("Share confirmation timeout (post may still have succeeded)");
  return { confirmed: false, postUrl: null };
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Upload an MP4 as an Instagram Reel to the logged-in account's feed.
 *
 * @param {string} filePath   - Absolute path to .mp4 file
 * @param {string} caption    - Caption with hashtags
 * @param {string} cookieFile - Path to saved cookies JSON
 * @param {string} profileUrl - Full Instagram profile URL (used to find post after share for caption editing)
 * @returns {Promise<boolean>}
 */
export async function uploadReelToFeed(filePath, caption, cookieFile, profileUrl = null) {
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

    // ── Step 7: Caption ───────────────────────────────────────────────────
    // Instagram's upload-flow caption field is a React-controlled contenteditable.
    // All browser-side methods (keyboard.type, execCommand, CDP insertText) update
    // the DOM visually but NOT React's internal state — Instagram reads React state
    // on Share, so the caption comes through empty.
    // Caption is applied reliably in Step 10 via the post-edit flow instead.
    log("Step 7: Caption will be applied after posting (Step 10).");
    await sleep(1000);

    // ── Step 8: Share (publish) ───────────────────────────────────────────
    log("Step 8: Clicking Share to publish...");
    const shareOk = await clickModalButton(page, "Share", 15000);
    if (!shareOk) throw new Error("Share button not found in modal header");

    // ── Step 9: Wait for confirmation ─────────────────────────────────────
    log("Step 9: Waiting for confirmation...");
    const { confirmed, postUrl: sharedPostUrl } = await waitForShareComplete(page, 120000);
    if (confirmed) {
      log("✅ Reel posted successfully!");
    } else {
      log("Share confirmation not detected — post may still have succeeded");
    }

    // Also check if the current page URL IS the post (Instagram sometimes redirects)
    const currentPageUrl = page.url();
    log(`Current URL after share: ${currentPageUrl}`);
    const directPostUrl =
      sharedPostUrl ||
      (/\/(reel|p)\/[A-Za-z0-9_-]{5,}/.test(currentPageUrl) ? currentPageUrl : null);

    await sleep(3000);
    await page.screenshot({ path: "/tmp/reel-upload-done.png" });

    // ── Step 10: Edit caption after posting ───────────────────────────────
    // Post first without a caption, then use the Edit flow to set it.
    // The Edit modal's contenteditable responds to page.keyboard.type() because
    // it fires real browser input events that React's event system processes.
    if (caption && caption.trim().length > 0 && profileUrl) {
      log("Step 10: Editing caption via Edit flow...");
      try {
        let postPageUrl = directPostUrl;

        if (postPageUrl) {
          log(`Using post URL from share confirmation: ${postPageUrl}`);
        } else {
          // Fall back: navigate to profile, wait for the new post to appear in the grid
          log("Navigating to profile to find latest post...");
          await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 });

          // Retry up to 5 times (with reload) until a post link appears
          for (let attempt = 0; attempt < 5; attempt++) {
            await sleep(3000);
            postPageUrl = await page.evaluate(() => {
              // Scope to <main> or [role="main"] to avoid nav/sidebar links
              const root =
                document.querySelector("main") ||
                document.querySelector('[role="main"]') ||
                document.body;
              const links = Array.from(root.querySelectorAll("a[href]"));
              const match = links.find(a =>
                /\/(reel|p)\/[A-Za-z0-9_-]{5,}/.test(a.href) &&
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

        // Intercept API responses so we can see what endpoint Instagram calls
        // when "Done" is clicked — useful for diagnosing if the save worked.
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
          const edit = btns.find(b => b.textContent.trim() === "Edit" && b.offsetParent !== null);
          if (edit) edit.click();
        });
        await sleep(3000); // Wait for Edit modal to fully render
        await page.screenshot({ path: "/tmp/reel-edit-modal.png" });

        // Find the caption contenteditable in the Edit modal
        const captionSelector = 'div[aria-label="Write a caption..."]';
        const captionEl = await page.$(captionSelector);
        if (!captionEl) throw new Error("Caption contenteditable not found in edit modal");

        // Click to focus, select-all any existing text, then type the caption.
        // page.keyboard.type() fires real keydown/keypress/input/keyup events —
        // React's synthetic event system responds to these and updates its state.
        await captionEl.click();
        await sleep(300);
        await page.keyboard.down("Meta"); // Cmd+A = select all on Mac
        await page.keyboard.press("a");
        await page.keyboard.up("Meta");
        await sleep(200);
        await page.keyboard.type(caption, { delay: 15 });
        await sleep(800);

        // Verify text is visible in the DOM
        const captionResult = await page.evaluate((sel) => {
          const div = document.querySelector(sel);
          return div
            ? `${div.textContent.trim().length} chars: "${div.textContent.trim().slice(0, 80)}"`
            : "not found";
        }, captionSelector);
        log(`Caption entered: ${captionResult}`);
        await page.screenshot({ path: "/tmp/reel-caption-before-done.png" });

        // Click "Done" in the Edit modal header (y < 150 to avoid other Done-like buttons)
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

        // Log intercepted API calls for diagnostics
        page.off("response", responseHandler);
        for (const entry of apiLog) {
          log(`[API intercepted] ${entry}`);
        }

        await page.screenshot({ path: "/tmp/reel-upload-caption-saved.png" });
        log("✅ Caption edit flow completed!");
      } catch (editErr) {
        log(`Caption edit failed: ${editErr.message} — post published without caption`);
        await page.screenshot({ path: "/tmp/reel-upload-caption-error.png" }).catch(() => {});
      }
    }

    success = true;

  } finally {
    await browser.close().catch(() => {});
  }

  return success;
}
