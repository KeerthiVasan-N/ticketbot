"use strict";

/**
 * Lightweight structured logger.
 * Wraps console methods with timestamps, log levels, and optional colour.
 */

const { LOG_CONFIG } = require("./config");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLOURS = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  reset: "\x1b[0m",
};

/** Zero-pad a number to 2 digits */
const pad = (n) => String(n).padStart(2, "0");

/** Returns current time as HH:MM:SS.mmm */
function timestamp() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function formatMessage(level, tag, msg) {
  const ts = LOG_CONFIG.timestamps ? `[${timestamp()}] ` : "";
  const lvl = level.toUpperCase().padEnd(5);
  const prefix = tag ? `[${tag}] ` : "";
  if (LOG_CONFIG.colorize) {
    const colour = COLOURS[level] || "";
    return `${colour}${ts}${lvl}${COLOURS.reset} ${prefix}${msg}`;
  }
  return `${ts}${lvl} ${prefix}${msg}`;
}

function log(level, tag, ...args) {
  if (LEVELS[level] < LEVELS[LOG_CONFIG.level]) return;
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = formatMessage(level, tag, msg);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Create a tagged child logger.
 * @param {string} tag  Short identifier, e.g. 'TicketBot' or 'WAHelper'
 */
function createLogger(tag) {
  return {
    debug: (...args) => log("debug", tag, ...args),
    info: (...args) => log("info", tag, ...args),
    warn: (...args) => log("warn", tag, ...args),
    error: (...args) => log("error", tag, ...args),
  };
}

module.exports = { createLogger, log };
