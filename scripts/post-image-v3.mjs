import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const IMAGE_PATH  = "/tmp/sunset-final.jpg";
const CAPTION     = "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  log("Clicking Create button...");
  await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="New post"]');
    if (svg) {
      let node = svg;
      for (let i = 0; i < 8; i++) {
        node = node.parentElement;
        if (!node) break;
        const tag = node.tagName?.toUpperCase();
        const role = node.getAttribute?.("role");
        if (tag === "A" || tag === "BUTTON" || role === "button" || role === "link") {
          node.click(); return;
        }
      }
    }
  });
  await sleep(2000);

  // ── Step 2: Click "Post" from dropdown ───────────────────────────────────
  log("Clicking Post from menu...");
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("button, a, div[role='menuitem'], div[role='button']"));
    const b = items.find(el => el.textContent.trim() === "Post" && el.offsetParent !== null);
    if (b) b.click();
  });
  await sleep(3000);
  await page.screenshot({ path: "/tmp/v3-step2.png" });

  // ── Check what's on screen now ────────────────────────────────────────────
  const pageState = await page.evaluate(() => {
    return {
      hasDialog: !!document.querySelector('div[role="dialog"]'),
      hasFileInput: !!document.querySelector('input[type="file"]'),
      hasSelectBtn: Array.from(document.querySelectorAll("button")).some(b => b.textContent.toLowerCase().includes("select")),
      bodyText: document.body.innerText.substring(0, 300),
    };
  });
  log("Page state after Post click: " + JSON.stringify(pageState));

  // ── Step 3: Set up file chooser interception and click "Select from computer" ──
  if (!pageState.hasFileInput) {
    log("No file input yet — looking for 'Select from computer' button...");

    // Look for the upload dialog area
    const uploadModalVisible = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll("span, button, div"));
      return spans.some(el => el.textContent.includes("Drag photos") || el.textContent.includes("Select from computer") || el.textContent.includes("drag photos"));
    });
    log("Upload modal visible: " + uploadModalVisible);

    if (uploadModalVisible) {
      // Set up file chooser interception
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }).catch(() => null),
        page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
          const b = btns.find(el => el.textContent.includes("Select from computer") || el.textContent.includes("Select From Computer"));
          if (b) { b.click(); return true; }
          return false;
        }),
      ]);

      if (fileChooser) {
        log("File chooser intercepted! Uploading file...");
        await fileChooser.accept([IMAGE_PATH]);
      } else {
        log("File chooser not intercepted, trying direct file input...");
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(IMAGE_PATH);
        } else {
          log("ERROR: No file input found after 'Select from computer'");
          await browser.close(); process.exit(1);
        }
      }
    } else {
      log("Upload modal not visible. Current state:");
      await page.screenshot({ path: "/tmp/v3-no-modal.png" });
      await browser.close(); process.exit(1);
    }
  } else {
    log("File input found directly, uploading...");
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(IMAGE_PATH);
  }

  log("File uploaded. Waiting for preview...");
  await sleep(5000);
  await page.screenshot({ path: "/tmp/v3-step3.png" });

  // ── Step 4: Next (crop) ───────────────────────────────────────────────────
  log("Clicking Next (crop)...");
  for (let i = 0; i < 15; i++) {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const b = btns.find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (b) { b.click(); return true; }
      return false;
    });
    if (clicked) { log("Crop Next clicked"); break; }
    await sleep(800);
  }
  await sleep(3000);
  await page.screenshot({ path: "/tmp/v3-step4.png" });

  // ── Step 5: Next (filter) ─────────────────────────────────────────────────
  log("Clicking Next (filter)...");
  for (let i = 0; i < 15; i++) {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
      const b = btns.find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (b) { b.click(); return true; }
      return false;
    });
    if (clicked) { log("Filter Next clicked"); break; }
    await sleep(800);
  }
  await sleep(3000);
  await page.screenshot({ path: "/tmp/v3-step5.png" });

  // ── Step 6: Caption ───────────────────────────────────────────────────────
  log("Looking for caption field...");
  await page.screenshot({ path: "/tmp/v3-step6-pre.png" });

  // Wait for caption step
  const captionSel = await page.evaluate(() => {
    const selectors = [
      'div[aria-label="Write a caption..."]',
      'div[aria-label="Write a caption…"]',
      'textarea[aria-label="Write a caption..."]',
      'div[role="textbox"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return sel;
    }
    return null;
  });

  if (captionSel) {
    await page.click(captionSel);
    await page.type(captionSel, CAPTION, { delay: 20 });
    log(`Caption typed via: ${captionSel}`);
  } else {
    log("Caption field not found via selectors, trying execCommand...");
    await page.evaluate((caption) => {
      const el = document.querySelector('div[contenteditable="true"]');
      if (el) { el.focus(); document.execCommand("insertText", false, caption); }
    }, CAPTION);
  }
  await sleep(2000);
  await page.screenshot({ path: "/tmp/v3-step6-post.png" });

  // ── Step 7: Share ─────────────────────────────────────────────────────────
  log("Clicking Share to publish...");

  // Find the blue Share button — it should be at the top of the modal
  const shareResult = await page.evaluate(() => {
    // Look for blue Share button specifically in the creation dialog
    const allBtns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const shareBtns = allBtns.filter(b => b.textContent.trim() === "Share" && b.offsetParent !== null);
    if (shareBtns.length === 0) return "not-found";
    // Click the first one (should be the Publish button)
    shareBtns[0].click();
    return `clicked (found ${shareBtns.length})`;
  });
  log(`Share result: ${shareResult}`);

  await sleep(10000);
  await page.screenshot({ path: "/tmp/v3-step7.png" });

  // Navigate to profile to confirm
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(4000);
  await page.screenshot({ path: "/tmp/v3-profile.png" });
  log("Done. Check /tmp/v3-profile.png");

  await sleep(3000);
  await browser.close();
})();
