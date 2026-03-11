/**
 * debug-create-menu.mjs
 * Clicks the "Create" button and screenshots + dumps all visible text to debug menu items.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const COOKIE_FILE = path.join(PROJECT_ROOT, ".instagram-session/cookies-riseclub9.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

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

  // Dismiss notifications popup
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const notNow = btns.find(b => b.textContent.trim() === "Not Now" || b.textContent.trim() === "Not now");
    if (notNow) notNow.click();
  });
  await sleep(500);

  await page.screenshot({ path: "/tmp/debug-step0-home.png" });
  log("Screenshot: /tmp/debug-step0-home.png");

  // Click the Create SVG
  log("Looking for Create button...");
  const createSvg = await page.$('svg[aria-label="New post"]');
  if (!createSvg) {
    log("ERROR: 'New post' SVG not found! Let's dump all SVG aria-labels:");
    const labels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("svg[aria-label]")).map(s => s.getAttribute("aria-label"));
    });
    log("SVG aria-labels: " + JSON.stringify(labels));
    await page.screenshot({ path: "/tmp/debug-no-create.png" });
  } else {
    const createBox = await createSvg.boundingBox();
    log(`Create button found at (${createBox.x}, ${createBox.y})`);
    await page.mouse.click(
      createBox.x + createBox.width / 2,
      createBox.y + createBox.height / 2
    );
    log("Clicked Create button, waiting 3s...");
    await sleep(3000);
    await page.screenshot({ path: "/tmp/debug-step1-after-create.png" });
    log("Screenshot: /tmp/debug-step1-after-create.png");

    // Dump ALL visible text nodes
    const allText = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const texts = [];
      let node;
      while ((node = walker.nextNode())) {
        const trimmed = node.textContent.trim();
        if (trimmed.length > 0 && trimmed.length < 100) {
          const el = node.parentElement;
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) {
            texts.push({ text: trimmed, x: Math.round(b.x), y: Math.round(b.y) });
          }
        }
      }
      return texts;
    });

    log("\nAll visible text nodes after clicking Create:");
    allText.forEach(t => log(`  "${t.text}" at (${t.x}, ${t.y})`));

    // Also check for any dropdown/menu elements
    const menuItems = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("div[role='menu'], ul[role='menu'], div[role='menuitem'], li[role='menuitem'], a[role='menuitem']"));
      return all.map(el => ({ tag: el.tagName, text: el.textContent.trim().substring(0, 50), role: el.getAttribute('role') }));
    });
    log("\nMenu elements found:");
    menuItems.forEach(m => log(`  <${m.tag} role="${m.role}"> "${m.text}"`));
  }

  log("\nKeeping browser open for 30s so you can see the state...");
  await sleep(30000);

} finally {
  await browser.close().catch(() => {});
}
