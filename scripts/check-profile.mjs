/**
 * check-profile.mjs
 * Opens the Instagram profile page for the logged-in account so we can verify the latest post.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR  = path.join(__dirname, "../.instagram-session");
const COOKIE_FILE  = path.join(SESSION_DIR, "cookies.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Load saved cookies
  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);

  // Go directly to the profile page
  console.log("Navigating to profile...");
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4000);

  await page.screenshot({ path: "/tmp/profile-check.png" });
  console.log("Screenshot saved to /tmp/profile-check.png");

  // Keep browser open for 30 seconds so user can see it
  console.log("Browser will stay open for 30 seconds...");
  await sleep(30000);
  await browser.close();
})();
