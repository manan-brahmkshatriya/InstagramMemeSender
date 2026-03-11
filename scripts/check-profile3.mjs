import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
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
  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);
  
  // Dismiss any popups
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dismiss = btns.find(b => b.textContent.trim() === "Not Now" || b.textContent.trim() === "Not now");
    if (dismiss) dismiss.click();
  });
  await sleep(1000);

  await page.screenshot({ path: "/tmp/profile-v3.png" });
  console.log("Current URL:", page.url());

  // Get post count and first few post links
  const info = await page.evaluate(() => {
    const url = window.location.href;
    const postLinks = Array.from(document.querySelectorAll('a[href*="/p/"]'))
      .slice(0, 9)
      .map(a => ({ href: a.href, hasImg: !!a.querySelector('img') }));
    
    // Get post count from the header
    const headerText = document.querySelector('header')?.innerText || '';
    
    return { url, postLinks, headerText: headerText.substring(0, 200) };
  });
  console.log("Info:", JSON.stringify(info, null, 2));

  // Click on the first post to see what it is
  if (info.postLinks.length > 0) {
    const firstPostUrl = info.postLinks[0].href;
    console.log("Opening first post:", firstPostUrl);
    await page.goto(firstPostUrl, { waitUntil: "networkidle2", timeout: 20000 });
    await sleep(3000);
    await page.screenshot({ path: "/tmp/first-post.png" });
  }

  await browser.close();
})();
