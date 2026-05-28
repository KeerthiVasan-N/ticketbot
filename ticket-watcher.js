"use strict";

/**
 * Ticket watcher — polls district.in for the "Book Tickets" button and
 * clicks it the instant it becomes available.
 *
 * Uses a tight poll loop rather than a MutationObserver so that the click
 * fires even if the page does a hard reload between checks.
 */

const { TICKET_CONFIG } = require("./config");
const { createLogger } = require("./logger");
const {
  sleep,
  retry,
  waitForSelectorSafe,
  clickIfPresent,
  ts,
} = require("./utils");

const log = createLogger("TicketWatcher");

// ── Selector lists ────────────────────────────────────────────────────────────

// Cascading list — try each in order; first match wins.
const BOOK_BTN_SELECTORS = [
  'button[data-testid="book-tickets"]',
  'a[data-testid="book-tickets"]',
  'button:has-text("Book Tickets")',
  'a:has-text("Book Tickets")',
  'button:has-text("Book Now")',
  'a:has-text("Book Now")',
];

const SOLD_OUT_SELECTORS = [
  '[data-testid="sold-out"]',
  ".sold-out",
  'button:disabled:has-text("Book")',
];

// ── Core watcher ──────────────────────────────────────────────────────────────

/**
 * Poll a district.in event page until "Book Tickets" appears, then click it.
 * Resolves when the button was successfully clicked (or the watcher is stopped).
 *
 * @param {import('playwright').Page} page
 * @param {{ onFound?: () => void, onSoldOut?: () => void }} [hooks]
 * @returns {Promise<boolean>}  true = clicked, false = gave up / sold out
 */
async function watchForTickets(page, hooks = {}) {
  const { onFound, onSoldOut } = hooks;
  let attempts = 0;

  log.info(`Starting ticket watch on: ${await page.url()}`);

  while (true) {
    attempts++;

    try {
      // Check for sold-out state first (cheaper selector)
      const soldOut = await page.evaluate((sels) => {
        return sels.some((s) => !!document.querySelector(s));
      }, SOLD_OUT_SELECTORS);

      if (soldOut) {
        log.warn(
          `[${ts()}] Tickets appear SOLD OUT — pausing 10 s before rechecking…`,
        );
        if (onSoldOut) onSoldOut();
        await sleep(10_000);
        continue;
      }

      // Try each book-button selector
      for (const sel of BOOK_BTN_SELECTORS) {
        const clicked = await clickIfPresent(page, sel, 500);
        if (clicked) {
          log.info(
            `[${ts()}] ✅ "Book Tickets" CLICKED! (selector: ${sel}, attempt #${attempts})`,
          );
          if (onFound) onFound();
          return true;
        }
      }

      // Full-text fallback via evaluate
      const clickedViaText = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("button, a"));
        const target = all.find((el) =>
          /book\s*(tickets?|now)/i.test(el.textContent),
        );
        if (target && !target.disabled) {
          target.click();
          return true;
        }
        return false;
      });

      if (clickedViaText) {
        log.info(
          `[${ts()}] ✅ "Book Tickets" clicked via text fallback (attempt #${attempts})`,
        );
        if (onFound) onFound();
        return true;
      }
    } catch (err) {
      log.debug(`Poll error (attempt ${attempts}): ${err.message}`);
    }

    await sleep(TICKET_CONFIG.pollIntervalMs);
  }
}

/**
 * Navigate to the target page and start watching.
 * Retries navigation up to `TICKET_CONFIG.maxRetries` times on failure.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 */
async function startWatcher(page, url) {
  await retry(
    () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    TICKET_CONFIG.maxRetries,
    2_000,
    "navigate",
  );
  return watchForTickets(page);
}

module.exports = { watchForTickets, startWatcher };
