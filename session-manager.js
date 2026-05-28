"use strict";

/**
 * Session manager — persists bot state between runs.
 *
 * Writes a small JSON file (session-state.json) next to the script so
 * that settings like AI-mode preference, last search query, and
 * notification timestamps survive across restarts.
 */

const fs = require("fs");
const path = require("path");
const { createLogger } = require("./logger");

const log = createLogger("Session");
const STATE_FILE = path.join(__dirname, "session-state.json");

const DEFAULT_STATE = {
  aiModeEnabled: false,
  lastQuery: null,
  lastTicketCheckAt: null,
  successfulBookings: 0,
  failedAttempts: 0,
  totalSearches: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Load state from disk, falling back to defaults if the file is absent/corrupt. */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch (err) {
    log.warn(`Could not read session state: ${err.message} — using defaults`);
  }
  return { ...DEFAULT_STATE };
}

/** Persist current state to disk. */
function saveState(state) {
  try {
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    log.error(`Failed to save session state: ${err.message}`);
  }
}

/**
 * Returns a state proxy that auto-saves on every property set.
 */
function createSessionState() {
  const raw = loadState();
  const state = new Proxy(raw, {
    set(target, prop, value) {
      target[prop] = value;
      saveState(target);
      return true;
    },
  });
  log.debug(
    `Session loaded — bookings: ${raw.successfulBookings}, searches: ${raw.totalSearches}`,
  );
  return state;
}

/** Increment a numeric counter in state. */
function increment(state, key, by = 1) {
  state[key] = (Number(state[key]) || 0) + by;
}

/** Reset mutable counters for a fresh run without touching created/updated timestamps. */
function resetRunCounters(state) {
  state.failedAttempts = 0;
  log.info("Run counters reset.");
}

module.exports = {
  createSessionState,
  increment,
  resetRunCounters,
  loadState,
  saveState,
};
