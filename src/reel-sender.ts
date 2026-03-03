import path from "path";
import { instagramBrowser } from "./instagram-browser.js";
import { log, logError } from "./logger.js";
import type { DownloadedReel } from "./types.js";

/**
 * Strategy A (preferred): Navigate to the reel page, click the Share icon,
 * find the target thread in the share modal, and send.
 * Preserves the reel format (recipient sees a proper reel card, not a raw video).
 */
async function sendViaReelShareModal(
  threadName: string,
  reel: DownloadedReel
): Promise<boolean> {
  const page = instagramBrowser.getPage();

  try {
    log(`reel-sender: Strategy A: sharing reel ${reel.reelUrl} to "${threadName}"`);
    await page.goto(reel.reelUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await instagramBrowser.randomDelay(2000, 3500);

    // Find share button — Instagram uses SVG with aria-label
    // Try multiple selector patterns for resilience
    let shareClicked = false;

    // Approach 1: find SVG with aria-label "Share" and click its parent button
    const shareBtn = await page.$('svg[aria-label="Share"]');
    if (shareBtn) {
      await page.evaluate((el) => {
        const btn = el.closest("button") as HTMLElement | null;
        btn?.click();
      }, shareBtn);
      shareClicked = true;
    }

    // Approach 2: aria-label on the button itself
    if (!shareClicked) {
      const btn = await page.$('button[aria-label*="Share"]');
      if (btn) {
        await btn.click();
        shareClicked = true;
      }
    }

    if (!shareClicked) {
      log("reel-sender: Strategy A: share button not found");
      return false;
    }

    await instagramBrowser.randomDelay(1500, 2500);

    // Wait for share modal with a visible search input.
    const modalReady = await page
      .waitForFunction(() => {
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        return dialogs.some((dialog) => {
          const rect = dialog.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(dialog);
          if (style.display === "none" || style.visibility === "hidden") return false;
          return (
            dialog.querySelector('input[placeholder="Search"]') !== null ||
            dialog.querySelector('input[aria-label*="Search"]') !== null
          );
        });
      }, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (!modalReady) {
      log("reel-sender: Strategy A: share modal did not open");
      return false;
    }

    // Search for the thread in the foreground modal only.
    const typed = await page.evaluate((name: string) => {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      const visibleDialogs = dialogs.filter((dialog) => {
        const rect = dialog.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(dialog);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      const activeDialog = visibleDialogs.at(-1) ?? null;
      if (!activeDialog) return false;

      const input = (activeDialog.querySelector(
        'input[placeholder="Search"], input[aria-label*="Search"]'
      ) ?? null) as HTMLInputElement | null;

      if (!input) return false;
      input.focus();
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.value = name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, threadName);

    if (!typed) {
      log("reel-sender: Strategy A: search input not found in modal");
      return false;
    }

    await instagramBrowser.randomDelay(1000, 2000);

    // Click matching thread in modal results
    const found = await page.evaluate((name: string) => {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      const visibleDialogs = dialogs.filter((dialog) => {
        const rect = dialog.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(dialog);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      const activeDialog = visibleDialogs.at(-1) ?? null;
      if (!activeDialog) return false;

      const items = Array.from(activeDialog.querySelectorAll('[role="listitem"]'));
      const match = items.find((el) => {
        const text = el.textContent ?? "";
        return text.toLowerCase().includes(name.toLowerCase());
      });
      if (match) {
        (match as HTMLElement).click();
        return true;
      }
      return false;
    }, threadName);

    if (!found) {
      log(`reel-sender: Strategy A: thread "${threadName}" not found in modal`);
      return false;
    }

    await instagramBrowser.randomDelay(800, 1500);

    // Click "Send" button in modal
    const sent = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      const visibleDialogs = dialogs.filter((dialog) => {
        const rect = dialog.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(dialog);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      const activeDialog = visibleDialogs.at(-1) ?? null;
      if (!activeDialog) return false;

      const buttons = Array.from(activeDialog.querySelectorAll("button"));
      const sendBtn = buttons.find(
        (b) => b.textContent?.trim() === "Send" || b.getAttribute("aria-label") === "Send"
      );
      if (sendBtn && !(sendBtn as HTMLButtonElement).disabled) {
        sendBtn.click();
        return true;
      }
      return false;
    });

    if (!sent) {
      log("reel-sender: Strategy A: Send button not found or disabled");
      return false;
    }

    await instagramBrowser.randomDelay(2000, 3500);
    log(`reel-sender: Strategy A: reel sent to "${threadName}" successfully`);
    return true;
  } catch (err) {
    logError(`reel-sender: Strategy A failed for "${threadName}"`, err);
    return false;
  }
}

/**
 * Strategy B (fallback): Navigate to DM inbox, find the thread, upload the .mp4 file.
 * Used when Strategy A's share modal fails.
 */
async function sendViaDirectUpload(
  threadName: string,
  reel: DownloadedReel
): Promise<boolean> {
  const page = instagramBrowser.getPage();

  try {
    log(`reel-sender: Strategy B: uploading video to "${threadName}" via DM inbox`);
    await page.goto("https://www.instagram.com/direct/inbox/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await instagramBrowser.randomDelay(2000, 3000);

    // Try to click existing thread in inbox list
    let threadFound = await page.evaluate((name: string) => {
      const items = Array.from(document.querySelectorAll('[role="listitem"]'));
      const match = items.find((el) => {
        return (el.textContent ?? "").toLowerCase().includes(name.toLowerCase());
      });
      if (match) {
        (match as HTMLElement).click();
        return true;
      }
      return false;
    }, threadName);

    // If not visible in list, use compose/search to find it
    if (!threadFound) {
      const composeBtn =
        (await page.$('[aria-label="New message"]')) ??
        (await page.$('[aria-label="Compose"]'));

      if (composeBtn) {
        await composeBtn.click();
        await instagramBrowser.randomDelay(1000, 2000);

        const typed = await page.evaluate((name: string) => {
          const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
          const visibleDialogs = dialogs.filter((dialog) => {
            const rect = dialog.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            const style = window.getComputedStyle(dialog);
            return style.display !== "none" && style.visibility !== "hidden";
          });
          const activeDialog = visibleDialogs.at(-1) ?? null;
          if (!activeDialog) return false;

          const input = (activeDialog.querySelector(
            'input[placeholder="Search"], input[aria-label*="Search"]'
          ) ?? null) as HTMLInputElement | null;
          if (!input) return false;

          input.focus();
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.value = name;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }, threadName);

        if (typed) {
          await instagramBrowser.randomDelay(1500, 2500);

          threadFound = await page.evaluate((name: string) => {
            const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
            const visibleDialogs = dialogs.filter((dialog) => {
              const rect = dialog.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;
              const style = window.getComputedStyle(dialog);
              return style.display !== "none" && style.visibility !== "hidden";
            });
            const activeDialog = visibleDialogs.at(-1) ?? null;
            if (!activeDialog) return false;

            const items = Array.from(activeDialog.querySelectorAll('[role="listitem"]'));
            const match = items.find((el) =>
              (el.textContent ?? "").toLowerCase().includes(name.toLowerCase())
            );
            if (match) {
              (match as HTMLElement).click();
              return true;
            }
            return false;
          }, threadName);
        }
      }
    }

    if (!threadFound) {
      log(`reel-sender: Strategy B: thread "${threadName}" not found in inbox`);
      return false;
    }

    await instagramBrowser.randomDelay(1500, 2500);

    // Wait for thread message input area
    await page.waitForSelector('[aria-label="Message"], [placeholder*="Message"]', {
      timeout: 10000,
    });

    // Find file input for media upload
    const attachmentInput = await page.$('input[type="file"][accept*="video"]') ??
      await page.$('input[type="file"]');

    if (!attachmentInput) {
      // Try clicking the attachment icon to reveal the file input
      const attachBtn =
        (await page.$('[aria-label="Add image or video"]')) ??
        (await page.$('[aria-label="Add Photo or Video"]')) ??
        (await page.$('[aria-label="Attach media"]'));

      if (attachBtn) {
        await attachBtn.click();
        await instagramBrowser.randomDelay(500, 1000);
      } else {
        log("reel-sender: Strategy B: attachment button not found");
        return false;
      }
    }

    // Upload the file
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      log("reel-sender: Strategy B: file input not found");
      return false;
    }

    await (fileInput as any).uploadFile(reel.tmpFilePath);
    log(`reel-sender: Strategy B: file upload triggered for ${path.basename(reel.tmpFilePath)}`);

    // Wait for upload to process
    await instagramBrowser.randomDelay(4000, 7000);

    // Click Send
    const sent = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const sendBtn = buttons.find(
        (b) =>
          b.textContent?.trim() === "Send" ||
          b.getAttribute("aria-label") === "Send" ||
          b.getAttribute("type") === "submit"
      );
      if (sendBtn && !(sendBtn as HTMLButtonElement).disabled) {
        sendBtn.click();
        return true;
      }
      return false;
    });

    if (!sent) {
      log("reel-sender: Strategy B: Send button not found or disabled after upload");
      return false;
    }

    await instagramBrowser.randomDelay(2000, 4000);
    log(`reel-sender: Strategy B: video sent to "${threadName}" successfully`);
    return true;
  } catch (err) {
    logError(`reel-sender: Strategy B failed for "${threadName}"`, err);
    return false;
  }
}

/**
 * Main send function: tries Strategy A (share from reel page) first,
 * falls back to Strategy B (direct upload via DM inbox).
 */
export async function sendReelToThread(
  threadName: string,
  reel: DownloadedReel
): Promise<boolean> {
  await instagramBrowser.ensureLoggedIn();

  // Strategy A: preserves reel format
  const strategyASuccess = await sendViaReelShareModal(threadName, reel);
  if (strategyASuccess) return true;

  // Strategy B: fallback upload
  log(`reel-sender: Strategy A failed, trying Strategy B for "${threadName}"`);
  await instagramBrowser.randomDelay(2000, 4000);
  return sendViaDirectUpload(threadName, reel);
}

/**
 * Send a reel URL as a plain DM text message — zero reel-page visits.
 *
 * Strategy 1: DM inbox — find the thread's div[role="button"] by name and click it.
 *             Works for both group threads and 1:1 DMs.
 * Strategy 2: Profile page fallback — navigate to instagram.com/{threadName}/,
 *             click the "Message" button. Works when the threadName is a username.
 */
export async function sendReelLinkToThread(
  threadName: string,
  reelUrl: string
): Promise<boolean> {
  await instagramBrowser.ensureLoggedIn();
  const page = instagramBrowser.getPage();

  try {
    // ── Strategy 1: find thread in DM inbox ──────────────────────────────
    log(`reel-sender: (link) looking up "${threadName}" in DM inbox`);
    await page.goto("https://www.instagram.com/direct/inbox/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await instagramBrowser.randomDelay(2000, 3000);

    const clickedInbox = await page.evaluate((name: string) => {
      const btn = Array.from(document.querySelectorAll('div[role="button"]'))
        .find((el) => (el.textContent ?? "").toLowerCase().includes(name.toLowerCase()));
      if (btn) { (btn as HTMLElement).click(); return true; }
      return false;
    }, threadName);

    if (clickedInbox) {
      log(`reel-sender: (link) opened thread "${threadName}" from inbox`);
    } else {
      // ── Strategy 2: profile page (1:1 DMs where threadName = username) ──
      log(`reel-sender: (link) "${threadName}" not in inbox, trying profile page`);
      await page.goto(
        `https://www.instagram.com/${encodeURIComponent(threadName)}/`,
        { waitUntil: "networkidle2", timeout: 30000 }
      );
      await instagramBrowser.randomDelay(2000, 3000);

      const clickedProfile = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('div[role="button"]'))
          .find((el) => (el.textContent ?? "").trim() === "Message");
        if (btn) { (btn as HTMLElement).click(); return true; }
        return false;
      });

      if (!clickedProfile) {
        log(`reel-sender: (link) could not open thread for "${threadName}"`);
        return false;
      }
      log(`reel-sender: (link) opened DM for "${threadName}" via profile`);
    }

    await instagramBrowser.randomDelay(2000, 3000);

    // Wait for message input
    const msgInput = await page.waitForSelector('[aria-label="Message"]', { timeout: 10000 });
    if (!msgInput) {
      log(`reel-sender: (link) message input not found for "${threadName}"`);
      return false;
    }

    await msgInput.click();
    await instagramBrowser.randomDelay(300, 600);
    await page.keyboard.type(reelUrl, { delay: 20 });
    await instagramBrowser.randomDelay(500, 1000);
    await page.keyboard.press("Enter");
    await instagramBrowser.randomDelay(2000, 3500);

    log(`reel-sender: (link) sent "${reelUrl}" to "${threadName}"`);
    return true;
  } catch (err) {
    logError(`reel-sender: (link) failed for "${threadName}"`, err);
    return false;
  }
}

/** Send a specific reel URL via share modal only (no scraping/downloading). */
export async function sendReelUrlToThread(
  threadName: string,
  reelUrl: string
): Promise<boolean> {
  await instagramBrowser.ensureLoggedIn();

  const placeholder: DownloadedReel = {
    tmpFilePath: "",
    fileSize: 0,
    caption: "",
    reelUrl,
  };

  return sendViaReelShareModal(threadName, placeholder);
}
