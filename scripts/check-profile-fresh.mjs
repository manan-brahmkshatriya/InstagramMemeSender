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

  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);
  
  await page.evaluate(() => {
    document.querySelectorAll("button").forEach(b => {
      if (b.textContent.trim() === "Not Now") b.click();
    });
  });
  await sleep(1000);

  // Scroll down to make sure grid loads
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(2000);
  await page.screenshot({ path: "/tmp/fresh-profile.png" });

  const data = await page.evaluate(() => {
    const headerText = document.querySelector("header")?.innerText?.substring(0, 200) || "";
    const allPostLinks = Array.from(document.querySelectorAll('a[href*="/p/"]'))
      .map(a => a.href)
      .filter((h, i, arr) => arr.indexOf(h) === i) // deduplicate
      .filter(h => h.includes("/mananb/"))
      .slice(0, 6);
    return { headerText, allPostLinks };
  });
  console.log("Header:", data.headerText);
  console.log("Recent mananb posts:", JSON.stringify(data.allPostLinks, null, 2));

  if (data.allPostLinks.length > 0) {
    await page.goto(data.allPostLinks[0], { waitUntil: "networkidle2", timeout: 20000 });
    await sleep(3000);
    await page.screenshot({ path: "/tmp/latest-post.png" });
    const info = await page.evaluate(() => ({
      date: document.querySelector("time")?.getAttribute("datetime"),
      imgSrc: document.querySelector("article img")?.src?.substring(0, 100),
      altText: document.querySelector("article img")?.alt?.substring(0, 100),
    }));
    console.log("Latest post info:", JSON.stringify(info));
  }

  await browser.close();
})();
