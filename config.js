"use strict";

/**
 * Central configuration for the ticketbot suite.
 * All tuneable constants live here so monitor.js stays clean.
 */

const path = require("path");

// ── Browser ────────────────────────────────────────────────────────────────
const USER_DATA_DIR = path.join(__dirname, "browser-session");

const BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1280,900",
];

// ── Ticket watcher ─────────────────────────────────────────────────────────
const TICKET_CONFIG = {
  targetUrl: "https://district.in",
  pollIntervalMs: 1_200,
  maxRetries: 5,
  bookButtonSelector: 'button[data-testid="book-tickets"], a[href*="book"]',
  pageReadySelector: "#app",
  headless: false,
};

// ── WhatsApp ───────────────────────────────────────────────────────────────
const WHATSAPP_CONFIG = {
  webUrl: "https://web.whatsapp.com",
  inputSelector: "#main footer div[contenteditable]",
  typingDelayMs: 30,
  sendDelayMs: 120,
  pollIntervalMs: 1_000,
  messageIconSelector: '[data-testid="msg-container"]',
};

// ── Google search ──────────────────────────────────────────────────────────
const GOOGLE_CONFIG = {
  baseUrl: "https://www.google.com/search",
  defaultParams: { hl: "en", lr: "lang_en", gl: "us" },
  aiModeParam: "udm=50",
  lensUrl: "https://lens.google.com/",
  tabOpenTimeoutMs: 30_000,
  snippetSelectors: [
    ".hgKElc",
    ".LGOjbe",
    "div.ujudUb",
    ".kp-hc",
    ".kp-blk",
    ".O83Yf",
  ],
};

// ── Logging ────────────────────────────────────────────────────────────────
const LOG_CONFIG = {
  level: process.env.LOG_LEVEL || "info", // 'debug' | 'info' | 'warn' | 'error'
  timestamps: true,
  colorize: process.stdout.isTTY,
};

// ── Feature flags ──────────────────────────────────────────────────────────
const FEATURES = {
  waatsupGameMode: true, // true → WhatsApp helper, false → ticket bot
  aiModeDefault: false, // AI Mode toggle default state
  forceGoogleEnglish: true,
  smartRetryInjection: true,
  smartRetryDelayMs: 350,
};

module.exports = {
  USER_DATA_DIR,
  BROWSER_ARGS,
  TICKET_CONFIG,
  WHATSAPP_CONFIG,
  GOOGLE_CONFIG,
  LOG_CONFIG,
  FEATURES,
};
