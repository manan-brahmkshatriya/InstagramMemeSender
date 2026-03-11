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
  log("Step 1: Clicking Create...");
  // Find the Create svg and click its ancestor link/button
  const createSvg = await page.$('svg[aria-label="New post"]');
  if (!createSvg) { log("No Create SVG found"); process.exit(1); }

  // Get bounding box of the svg and click its center
  const box = await createSvg.boundingBox();
  log(`Create SVG at: ${JSON.stringify(box)}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(2000);

  // ── Step 2: Find and click "Post" menu item ───────────────────────────────
  log("Step 2: Finding Post menu item...");
  await page.screenshot({ path: "/tmp/v4-menu.png" });

  // Get all visible text nodes to find Post
  const menuItems = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim() === "Post") {
        const el = node.parentElement;
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          results.push({
            tag: el.tagName,
            text: el.textContent.trim(),
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            classes: el.className,
          });
        }
      }
    }
    return results;
  });
  log("Post menu items found: " + JSON.stringify(menuItems));

  if (menuItems.length === 0) {
    log("ERROR: No Post menu item found");
    await browser.close(); process.exit(1);
  }

  // Set up file chooser BEFORE clicking Post (since it may open native dialog)
  log("Setting up file chooser interception...");
  const fileChooserPromise = page.waitForFileChooser({ timeout: 10000 }).catch(() => null);

  // Click the Post menu item by coordinates
  const postItem = menuItems[0];
  log(`Clicking Post at (${postItem.x}, ${postItem.y})`);
  await page.mouse.click(postItem.x, postItem.y);
  await sleep(2000);

  // Check if file chooser was triggered
  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    log("File chooser intercepted! Accepting file...");
    await fileChooser.accept([IMAGE_PATH]);
    await sleep(5000);
  } else {
    log("No native file chooser triggered. Checking for modal...");
    await page.screenshot({ path: "/tmp/v4-after-post.png" });

    // Check for file input or "Select from computer"
    const state = await page.evaluate(() => ({
      hasFileInput: !!document.querySelector('input[type="file"]'),
      hasSelectBtn: Array.from(document.querySelectorAll("button")).some(b => b.textContent.includes("Select from computer")),
      hasDragArea: document.body.innerText.includes("Drag photos") || document.body.innerText.includes("drag"),
    }));
    log("State: " + JSON.stringify(state));

    if (state.hasFileInput) {
      const fileInput = await page.$('input[type="file"]');
      log("Found hidden file input, uploading directly...");
      await fileInput.uploadFile(IMAGE_PATH);
      await sleep(5000);
    } else if (state.hasSelectBtn || state.hasDragArea) {
      // Click "Select from computer" with file chooser interception
      const [fc2] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }).catch(() => null),
        page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
          const b = btns.find(el => el.textContent.includes("Select from computer") || el.textContent.includes("Select From Computer"));
          if (b) { b.click(); return true; }
          return false;
        }),
      ]);
      if (fc2) {
        log("File chooser intercepted via 'Select from computer'");
        await fc2.accept([IMAGE_PATH]);
        await sleep(5000);
      } else {
        log("Looking for file input after 'Select from computer'...");
        const fi = await page.$('input[type="file"]');
        if (fi) await fi.uploadFile(IMAGE_PATH);
        await sleep(5000);
      }
    } else {
      log("ERROR: Upload modal not found");
      await browser.close(); process.exit(1);
    }
  }

  await page.screenshot({ path: "/tmp/v4-uploaded.png" });
  log("After upload screenshot saved");

  // ── Next (crop) ───────────────────────────────────────────────────────────
  log("Clicking Next (crop)...");
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button, div[role='button']")).find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    if (done) { log("Crop Next clicked"); break; }
    await sleep(500);
  }
  await sleep(3000);
  await page.screenshot({ path: "/tmp/v4-crop.png" });

  // ── Next (filter) ─────────────────────────────────────────────────────────
  log("Clicking Next (filter)...");
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button, div[role='button']")).find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    if (done) { log("Filter Next clicked"); break; }
    await sleep(500);
  }
  await sleep(3000);
  await page.screenshot({ path: "/tmp/v4-filter.png" });

  // ── Caption ───────────────────────────────────────────────────────────────
  log("Adding caption...");
  await page.screenshot({ path: "/tmp/v4-caption-pre.png" });
  for (const sel of ['div[aria-label*="caption"]', 'div[role="textbox"]', 'textarea']) {
    try {
      await page.click(sel, { timeout: 2000 });
      await page.type(sel, CAPTION, { delay: 15 });
      log("Caption added via: " + sel);
      break;
    } catch {}
  }
  await sleep(2000);
  await page.screenshot({ path: "/tmp/v4-caption-post.png" });

  // ── Share ─────────────────────────────────────────────────────────────────
  log("Clicking Share...");
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button, div[role='button']")).find(el => el.textContent.trim() === "Share" && el.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    if (done) { log("Share clicked!"); break; }
    await sleep(500);
  }

  await sleep(10000);
  await page.screenshot({ path: "/tmp/v4-result.png" });

  // Verify on profile
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(4000);
  await page.screenshot({ path: "/tmp/v4-profile.png" });
  log("Done! Check /tmp/v4-profile.png");

  await sleep(3000);
  await browser.close();
})();
