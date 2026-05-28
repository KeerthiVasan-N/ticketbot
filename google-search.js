"use strict";

/**
 * Google search helpers.
 *
 * Builds search URLs, opens tabs in the shared context, and provides
 * utilities for extracting answers from Google result pages — used by the
 * WhatsApp game helper to auto-answer trivia and lyrics questions.
 */

const { GOOGLE_CONFIG } = require("./config");
const { createLogger } = require("./logger");
const { appendParams, forceGoogleEnglishUrl, sleep } = require("./utils");

const log = createLogger("GoogleSearch");

// ── URL builders ─────────────────────────────────────────────────────────────

/**
 * Build a Google search URL from a plain query string.
 * @param {string} query
 * @param {boolean} [aiMode=false]  Append udm=50 for AI Overview results.
 * @returns {string}
 */
function buildSearchUrl(query, aiMode = false) {
  const base = GOOGLE_CONFIG.baseUrl;
  const params = { ...GOOGLE_CONFIG.defaultParams, q: query };
  if (aiMode) params.udm = "50";
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Build a Google Lens URL (for image-based reverse search).
 * The caller is responsible for pasting the image after navigation.
 * @returns {string}
 */
function buildLensUrl() {
  return GOOGLE_CONFIG.lensUrl;
}

// ── Tab management ────────────────────────────────────────────────────────────

/**
 * Open a new Google search tab in the given context.
 * @param {import('playwright').BrowserContext} context
 * @param {string} query
 * @param {boolean} [aiMode=false]
 * @returns {Promise<import('playwright').Page>}
 */
async function openSearchTab(context, query, aiMode = false) {
  const url = forceGoogleEnglishUrl(buildSearchUrl(query, aiMode));
  log.info(`Opening search tab: ${query.slice(0, 60)}${aiMode ? " [AI]" : ""}`);
  const page = await context.newPage();
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: GOOGLE_CONFIG.tabOpenTimeoutMs,
  });
  return page;
}

/**
 * Open a Google Lens tab and paste the copied image.
 * @param {import('playwright').BrowserContext} context
 * @param {string} [suffixQuery]  Optional text to refine the Lens search.
 * @returns {Promise<import('playwright').Page>}
 */
async function openLensTab(context, suffixQuery = "") {
  log.info("Opening Lens tab…");
  const page = await context.newPage();
  await page.bringToFront();
  await page.goto(buildLensUrl(), {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  await sleep(600);
  await page.keyboard.press("Control+v");

  if (suffixQuery && suffixQuery.trim()) {
    try {
      await page.waitForSelector('input[name="q"], textarea[name="q"]', {
        timeout: 8_000,
      });
      await sleep(300);
      await page.keyboard.type(" " + suffixQuery.trim(), { delay: 40 });
      await page.keyboard.press("Enter");
    } catch (err) {
      log.warn(`Could not type Lens suffix query: ${err.message}`);
    }
  }
  return page;
}

// ── Result extraction ─────────────────────────────────────────────────────────

/**
 * Attempt to extract a featured-snippet / AI overview answer from an already-
 * loaded Google results page.
 * Returns the answer string or null.
 * @param {import('playwright').Page} page
 */
async function extractTopAnswer(page) {
  try {
    return await page.evaluate((selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) {
          return el.innerText.trim().split("\n").slice(0, 3).join(" ");
        }
      }
      // Fallback: first bold text in search results
      const bold = document.querySelector("#rso b, #rso strong");
      return bold ? bold.innerText.trim() : null;
    }, GOOGLE_CONFIG.snippetSelectors);
  } catch {
    return null;
  }
}

module.exports = {
  buildSearchUrl,
  buildLensUrl,
  openSearchTab,
  openLensTab,
  extractTopAnswer,
};
