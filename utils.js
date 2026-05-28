"use strict";

/**
 * General-purpose utility helpers shared across the ticketbot modules.
 */

// ── Timing ─────────────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry an async fn up to `times` with `delayMs` between attempts */
async function retry(fn, times = 3, delayMs = 1_000, label = "op") {
  let lastErr;
  for (let i = 1; i <= times; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < times) {
        console.warn(
          `[utils] ${label} attempt ${i}/${times} failed: ${err.message} — retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

// ── URL helpers ─────────────────────────────────────────────────────────────

/**
 * Appends or overrides query-string params on a URL string.
 * @param {string} rawUrl
 * @param {Record<string, string>} params
 * @returns {string}
 */
function appendParams(rawUrl, params) {
  try {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Force Google URLs to English locale.
 * No-ops for non-Google URLs.
 */
function forceGoogleEnglishUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("google.")) return rawUrl;
    url.searchParams.set("hl", "en");
    url.searchParams.set("lr", "lang_en");
    url.searchParams.set("gl", "us");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// ── Text helpers ────────────────────────────────────────────────────────────

/**
 * Normalises text for safe pasting into WhatsApp:
 * removes zero-width chars, collapses whitespace, strips wrapping quotes.
 */
function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["""'''\u2018\u2019\u201C\u201D]+/, "")
    .replace(/["""'''\u2018\u2019\u201C\u201D]+$/, "")
    .trim();
}

/**
 * Truncate a string to `maxLen` chars, appending '…' if truncated.
 */
function truncate(str, maxLen = 80) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

// ── Timestamp ──────────────────────────────────────────────────────────────

/** Returns a compact timestamp string like 14:03:07.291 */
function ts() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// ── DOM / Playwright helpers ────────────────────────────────────────────────

/**
 * Wait for a CSS selector to appear on a Playwright page, with a timeout.
 * Resolves to null on timeout instead of throwing.
 */
async function waitForSelectorSafe(page, selector, timeoutMs = 10_000) {
  try {
    return await page.waitForSelector(selector, { timeout: timeoutMs });
  } catch {
    return null;
  }
}

/**
 * Click an element if it exists; resolves false if not found.
 */
async function clickIfPresent(page, selector, timeoutMs = 5_000) {
  const el = await waitForSelectorSafe(page, selector, timeoutMs);
  if (!el) return false;
  try {
    await el.click();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  sleep,
  retry,
  appendParams,
  forceGoogleEnglishUrl,
  normalizeText,
  truncate,
  ts,
  waitForSelectorSafe,
  clickIfPresent,
};
