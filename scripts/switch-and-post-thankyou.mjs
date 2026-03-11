/**
 * Opens browser as mananb, navigates to account switch UI,
 * waits for user to switch to dailyitemstreak, then posts the thank you image.
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "../.instagram-session");
const MANANB_COOKIES = path.join(SESSION_DIR, "cookies.json");
const DAILY_COOKIES = path.join(SESSION_DIR, "cookies-dailyitemstreak.json");

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickModalHeaderButton(page, text, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate((text) => {
      const btn = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button']")).find(el => {
        if (el.textContent.trim() !== text) return false;
        if (el.offsetParent === null) return false;
        const b = el.getBoundingClientRect();
        return b.y < 130 && b.width > 0 && b.height > 0;
      });
      if (btn) { btn.click(); const b = btn.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y) }; }
      return null;
    }, text);
    if (result) { log(`Clicked "${text}" at ${JSON.stringify(result)}`); return true; }
    await sleep(500);
  }
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

  // Load mananb cookies
  const cookies = JSON.parse(fs.readFileSync(MANANB_COOKIES, "utf-8"));
  await page.setCookie(...cookies);

  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  log("Logged in as mananb");

  // Navigate to account switch — click the profile icon at bottom of sidebar
  // which opens a menu with "Switch accounts"
  log("Navigating to account switcher...");
  await page.goto("https://www.instagram.com/accounts/login/?next=/", { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
  await sleep(1000);
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(2000);

  // Click the bottom-left avatar/profile button which shows "Switch accounts"
  const profileMenuClicked = await page.evaluate(() => {
    // Find avatar/profile link in the nav
    const navItems = Array.from(document.querySelectorAll('a, div[role="button"]'));
    // Look for the item with profile image or "Profile" text
    for (const item of navItems) {
      const img = item.querySelector('img');
      if (img && item.closest('nav, aside, [role="navigation"]')) {
        const rect = item.getBoundingClientRect();
        if (rect.y > 600) { // bottom of sidebar
          item.click();
          return { clicked: true, y: rect.y };
        }
      }
    }
    return null;
  });
  log("Profile menu click: " + JSON.stringify(profileMenuClicked));
  await sleep(2000);
  await page.screenshot({ path: "/tmp/switch2-menu.png" });

  // Look for "Switch" button  
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const sw = all.find(el => el.textContent.trim() === "Switch" && el.offsetParent !== null);
    if (sw) sw.click();
  });
  await sleep(1000);
  await page.screenshot({ path: "/tmp/switch2-after.png" });

  log("=======================================================");
  log("BROWSER IS OPEN. Please switch to 'dailyitemstreak':");
  log("  1. Click your profile icon at the bottom-left");
  log("  2. Click 'Switch' next to dailyitemstreak");
  log("  OR: Click your username at top, then switch account");
  log("Waiting up to 3 minutes...");
  log("=======================================================");

  // Wait up to 3 minutes for the switch
  let switched = false;
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    const state = await page.evaluate(() => {
      // Check if we're now showing dailyitemstreak
      const profileLinks = Array.from(document.querySelectorAll('a[href*="/dailyitemstreak"]'));
      const inBody = document.body.innerText.includes("dailyitemstreak");
      const navText = document.querySelector('nav, aside')?.innerText || '';
      return { profileLinks: profileLinks.length, inBody, navText: navText.substring(0, 100), url: window.location.href };
    });

    if (state.inBody || state.profileLinks > 0) {
      // Verify it's showing as the active account (not just a suggestion)
      const isActive = await page.evaluate(() => {
        // Check if logged-in user is dailyitemstreak
        const avatarLink = document.querySelector('a[href="/dailyitemstreak/"]');
        return !!avatarLink;
      });
      if (isActive) {
        log("✅ Switched to dailyitemstreak! Saving cookies...");
        const newCookies = await page.cookies();
        fs.writeFileSync(DAILY_COOKIES, JSON.stringify(newCookies, null, 2));
        log("Cookies saved: " + DAILY_COOKIES);
        switched = true;
        break;
      }
    }
    if (i % 15 === 0) log(`[${i}s] Waiting for switch...`);
  }

  if (!switched) {
    log("Switch not detected automatically. Checking current session...");
    const currentCookies = await page.cookies();
    fs.writeFileSync(DAILY_COOKIES, JSON.stringify(currentCookies, null, 2));
    log("Saved current cookies anyway.");
  }

  // ── Now post the thank you image ─────────────────────────────────────────
  log("Waiting for thank you image to be ready...");
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync("/tmp/thankyou-final.jpg")) { log("Image ready!"); break; }
    await sleep(1000);
    if (i % 10 === 0) log(`[${i}s] Waiting for image...`);
  }

  if (!fs.existsSync("/tmp/thankyou-final.jpg")) {
    log("Image not ready. Exiting.");
    await browser.close(); process.exit(1);
  }

  // ── Post to dailyitemstreak ───────────────────────────────────────────────
  log("Starting post flow...");
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Click Create
  const createSvg = await page.$('svg[aria-label="New post"]');
  if (!createSvg) { log("No Create button found!"); await browser.close(); process.exit(1); }
  const cb = await createSvg.boundingBox();
  await page.mouse.click(cb.x + cb.width/2, cb.y + cb.height/2);
  await sleep(2000);

  // Click Post
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

  // Upload file
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) { log("No file input!"); await browser.close(); process.exit(1); }
  await fileInput.uploadFile("/tmp/thankyou-final.jpg");
  log("Uploaded thank you image");
  await sleep(5000);

  // Next (crop)
  await clickModalHeaderButton(page, "Next", 15000);
  await sleep(4000);
  // Next (filter)
  await clickModalHeaderButton(page, "Next", 15000);
  await sleep(4000);
  await page.screenshot({ path: "/tmp/thankyou-caption.png" });

  // Type caption
  await page.evaluate((caption) => {
    const el = document.querySelector('div[aria-label*="caption"]') || document.querySelector('div[contenteditable="true"]');
    if (el) { el.focus(); el.innerHTML = ''; document.execCommand('insertText', false, caption); }
  }, "Thank you so much for all your love and support! 🙏❤️ #thankful #gratitude #blessed");
  await sleep(2000);

  // Share
  await clickModalHeaderButton(page, "Share", 15000);
  log("Share clicked! Waiting for upload...");

  // Wait for sharing to complete
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const done = await page.evaluate(() => {
      const body = document.body.innerText;
      return !body.includes("Sharing") && !document.querySelector('div[aria-label*="caption"]');
    });
    if (done) { log(`✅ Post shared after ${i+1}s!`); break; }
    if (i % 5 === 0) log(`[${i}s] Uploading...`);
  }

  await page.screenshot({ path: "/tmp/thankyou-result.png" });
  log("DONE! Check /tmp/thankyou-result.png");
  await sleep(5000);
  await browser.close();
})();
