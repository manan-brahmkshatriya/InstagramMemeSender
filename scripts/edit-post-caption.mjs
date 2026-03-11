/**
 * edit-post-caption.mjs
 * Finds the most recent post on mananb's profile and edits the caption.
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const NEW_CAPTION = "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";

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

  // Go to profile
  log("Opening profile...");
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4000);

  // Dismiss popups
  await page.evaluate(() => {
    document.querySelectorAll("button").forEach(b => { if (b.textContent.trim() === "Not Now") b.click(); });
  });
  await sleep(1000);

  // Get the first (most recent) mananb post link
  const firstPost = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/p/"]'))
      .filter(a => a.href.includes("/mananb/"));
    return links[0]?.href || null;
  });
  log("Most recent post: " + firstPost);

  if (!firstPost) { log("No posts found"); await browser.close(); process.exit(1); }

  // Open the post
  await page.goto(firstPost, { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(3000);
  await page.screenshot({ path: "/tmp/edit-post-open.png" });

  // Click the "..." (more options) button on the post
  log("Clicking More options (...)...");
  const moreClicked = await page.evaluate(() => {
    // Look for the "More options" svg or button
    const svgs = Array.from(document.querySelectorAll('svg[aria-label="More options"]'));
    if (svgs.length > 0) {
      let node = svgs[0];
      for (let i = 0; i < 5; i++) {
        node = node.parentElement;
        if (!node) break;
        const tag = node.tagName?.toUpperCase();
        const role = node.getAttribute?.("role");
        if (tag === "BUTTON" || role === "button") { node.click(); return true; }
      }
    }
    // Fallback: look for "..." button
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const more = btns.find(b => b.querySelector('svg[aria-label="More options"]'));
    if (more) { more.click(); return true; }
    return false;
  });
  log("More options clicked: " + moreClicked);
  await sleep(2000);
  await page.screenshot({ path: "/tmp/edit-post-menu.png" });

  // Click "Edit" from the menu
  log("Clicking Edit...");
  const editClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button'], div[role='menuitem']"));
    const edit = btns.find(b => b.textContent.trim() === "Edit" && b.offsetParent !== null);
    if (edit) { edit.click(); return true; }
    return false;
  });
  log("Edit clicked: " + editClicked);
  await sleep(2000);
  await page.screenshot({ path: "/tmp/edit-post-editor.png" });

  // Find the caption textarea and type the new caption
  log("Finding caption field...");
  const captionField = await page.evaluate(() => {
    const selectors = [
      'textarea[aria-label*="caption"]',
      'textarea',
      'div[aria-label*="caption"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return sel;
    }
    return null;
  });
  log("Caption field selector: " + captionField);

  if (!captionField) {
    log("Caption field not found — taking screenshot");
    await page.screenshot({ path: "/tmp/edit-no-caption.png" });
    await browser.close(); process.exit(1);
  }

  // Clear any existing text and type new caption
  await page.click(captionField);
  await sleep(500);
  
  // Select all and replace
  await page.keyboard.down('Meta');
  await page.keyboard.press('a');
  await page.keyboard.up('Meta');
  await sleep(300);
  
  await page.type(captionField, NEW_CAPTION, { delay: 20 });
  log("Caption typed: " + NEW_CAPTION);
  await sleep(2000);
  await page.screenshot({ path: "/tmp/edit-post-captioned.png" });

  // Click "Done" to save
  log("Clicking Done...");
  const doneClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const done = btns.find(b => (b.textContent.trim() === "Done" || b.textContent.trim() === "Save") && b.offsetParent !== null);
    if (done) { done.click(); return done.textContent.trim(); }
    return null;
  });
  log("Done/Save clicked: " + doneClicked);
  await sleep(3000);
  await page.screenshot({ path: "/tmp/edit-post-saved.png" });

  log("✅ Caption edit complete!");
  await sleep(3000);
  await browser.close();
})();
