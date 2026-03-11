/**
 * Logs in as mananb, then switches to dailyitemstreak via account switcher.
 * Saves dailyitemstreak cookies to .instagram-session/cookies-dailyitemstreak.json
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "../.instagram-session");
const COOKIE_FILE = path.join(SESSION_DIR, "cookies.json"); // mananb cookies

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

  // Load mananb cookies
  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);
  log("Loaded mananb cookies");

  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  log("Logged in as mananb. URL: " + page.url());
  await page.screenshot({ path: "/tmp/switch-step1.png" });

  // Find the account switcher — click the profile avatar/button at the bottom of the sidebar
  log("Looking for account switcher...");
  
  // Method 1: Look for the profile section that has a down arrow / "Switch" link
  const switchClicked = await page.evaluate(() => {
    // Try clicking the profile menu button (bottom of left sidebar)
    const profileBtn = document.querySelector('a[href="/mananb/"]') ||
                       Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/mananb/') && a.querySelector('img'));
    if (profileBtn) { profileBtn.click(); return "profile-link"; }
    return null;
  });
  log("Switch attempt 1: " + switchClicked);
  await sleep(2000);
  await page.screenshot({ path: "/tmp/switch-step2.png" });

  // Look for "Switch" button or account list
  const switchResult = await page.evaluate(() => {
    // Look for "Switch" text button
    const btns = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button'], a"));
    const switchBtn = btns.find(b => b.textContent.trim() === "Switch" && b.offsetParent !== null);
    if (switchBtn) { switchBtn.click(); return "found-switch-btn"; }

    // Look for dailyitemstreak in any dropdown
    const allLinks = Array.from(document.querySelectorAll("*"));
    const daily = allLinks.find(el => el.textContent.trim() === "dailyitemstreak" && el.offsetParent !== null);
    if (daily) { daily.click(); return "found-dailyitemstreak"; }
    
    return null;
  });
  log("Switch result: " + switchResult);
  await sleep(2000);
  await page.screenshot({ path: "/tmp/switch-step3.png" });

  // Check current account
  const currentUser = await page.evaluate(() => {
    // Try to detect logged-in user
    const profileLinks = Array.from(document.querySelectorAll('a[href^="/"]'))
      .filter(a => {
        const href = a.href;
        return href.match(/instagram\.com\/[a-z0-9._]+\/?$/) && !href.includes('/explore') && !href.includes('/reels') && !href.includes('/direct');
      })
      .map(a => a.href);
    return profileLinks.slice(0, 5);
  });
  log("Visible profile links: " + JSON.stringify(currentUser));

  // Keep browser open so user can manually switch if needed
  log("Waiting 60s for manual account switch if needed...");
  log("Please switch to 'dailyitemstreak' account in the browser if not already done.");
  
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const urlCheck = await page.evaluate(() => {
      // Check if we're now on dailyitemstreak session
      const bodyText = document.body.innerText;
      return {
        url: window.location.href,
        hasDailyItemStreak: bodyText.includes("dailyitemstreak"),
      };
    });
    
    if (urlCheck.hasDailyItemStreak) {
      log("✅ Detected dailyitemstreak! Saving cookies...");
      const newCookies = await page.cookies();
      const outFile = path.join(SESSION_DIR, "cookies-dailyitemstreak.json");
      fs.writeFileSync(outFile, JSON.stringify(newCookies, null, 2));
      log("Cookies saved to: " + outFile);
      break;
    }
    if (i % 10 === 0) log(`[${i}s] Waiting for account switch...`);
  }

  await page.screenshot({ path: "/tmp/switch-final.png" });
  await sleep(3000);
  await browser.close();
})();
