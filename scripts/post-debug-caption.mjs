/**
 * Debug script: Goes up to caption step and dumps all button info
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const IMAGE_PATH = "/tmp/sunset-final.jpg";

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

  // Click Create
  const createSvg = await page.$('svg[aria-label="New post"]');
  const box = await createSvg.boundingBox();
  await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await sleep(2000);

  // Click Post
  const menuItems = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim() === "Post") {
        const el = node.parentElement;
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.height > 0) {
          results.push({ x: b.x + b.width/2, y: b.y + b.height/2 });
        }
      }
    }
    return results;
  });
  if (menuItems.length > 0) await page.mouse.click(menuItems[0].x, menuItems[0].y);
  await sleep(3000);

  // Upload file
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.uploadFile(IMAGE_PATH);
    log("Uploaded file");
  }
  await sleep(5000);

  // Click Next (crop)
  for (let i = 0; i < 15; i++) {
    const done = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    if (done) { log("Crop Next"); break; }
    await sleep(500);
  }
  await sleep(3000);

  // Click Next (filter)
  for (let i = 0; i < 15; i++) {
    const done = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find(el => el.textContent.trim() === "Next" && el.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    if (done) { log("Filter Next"); break; }
    await sleep(500);
  }
  await sleep(3000);

  // Now on caption page - DUMP ALL button info
  log("=== CAPTION PAGE BUTTON DUMP ===");
  const buttons = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button']"));
    return all
      .filter(el => el.offsetParent !== null)
      .map(el => {
        const b = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 50),
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.width),
          h: Math.round(b.height),
          class: el.className.substring(0, 80),
          disabled: el.disabled,
        };
      })
      .filter(b => b.text.length > 0);
  });
  buttons.forEach(b => log(JSON.stringify(b)));

  await page.screenshot({ path: "/tmp/caption-debug.png" });
  log("Caption page screenshot saved");

  // Try typing caption
  for (const sel of ['div[aria-label*="caption"]', 'div[role="textbox"]']) {
    try {
      await page.click(sel, { timeout: 2000 });
      await page.type(sel, "Beautiful sunset 🌅 #sunset #sky #nature", { delay: 15 });
      log("Caption typed via: " + sel);
      break;
    } catch {}
  }
  await sleep(2000);
  await page.screenshot({ path: "/tmp/caption-debug-typed.png" });

  // Dump buttons again after typing
  log("=== AFTER TYPING BUTTONS ===");
  const buttons2 = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button']"));
    return all
      .filter(el => el.offsetParent !== null)
      .map(el => {
        const b = el.getBoundingClientRect();
        return { text: el.textContent.trim().substring(0, 50), x: Math.round(b.x), y: Math.round(b.y), disabled: el.disabled };
      })
      .filter(b => b.text.length > 0);
  });
  buttons2.forEach(b => log(JSON.stringify(b)));

  // Keep open for manual inspection
  log("Keeping browser open for 30s for manual inspection...");
  await sleep(30000);
  await browser.close();
})();
