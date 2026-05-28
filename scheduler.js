"use strict";

/**
 * Scheduler — runs a callback on a cron-like interval.
 *
 * Used to periodically re-check whether the district.in ticket page has
 * changed (e.g. refreshing after a sold-out state) and to schedule
 * keep-alive pings so the browser session doesn't time out overnight.
 */

const { createLogger } = require("./logger");
const { sleep, ts } = require("./utils");

const log = createLogger("Scheduler");

/**
 * A lightweight repeating task descriptor.
 * @typedef {{ name: string, fn: () => Promise<void>, intervalMs: number, _running: boolean, _timer: NodeJS.Timeout|null }} Task
 */

/** @type {Map<string, Task>} */
const tasks = new Map();

/**
 * Register and immediately start a named repeating task.
 *
 * @param {string} name         Unique task name.
 * @param {() => Promise<void>} fn         Async function to run on each tick.
 * @param {number} intervalMs   Milliseconds between ticks (measured from completion).
 */
function schedule(name, fn, intervalMs) {
  if (tasks.has(name)) {
    log.warn(
      `Task "${name}" is already scheduled — call cancel() first to replace it.`,
    );
    return;
  }

  const task = { name, fn, intervalMs, _running: true, _timer: null };
  tasks.set(name, task);
  log.info(`Scheduled "${name}" every ${intervalMs}ms`);

  const tick = async () => {
    if (!task._running) return;
    try {
      await fn();
    } catch (err) {
      log.error(`Task "${name}" error: ${err.message}`);
    }
    if (task._running) {
      task._timer = setTimeout(tick, intervalMs);
    }
  };

  // Kick off immediately.
  task._timer = setTimeout(tick, 0);
}

/**
 * Cancel a running task by name.
 * @param {string} name
 */
function cancel(name) {
  const task = tasks.get(name);
  if (!task) return;
  task._running = false;
  if (task._timer) clearTimeout(task._timer);
  tasks.delete(name);
  log.info(`Cancelled task "${name}"`);
}

/** Cancel all running tasks. */
function cancelAll() {
  for (const name of tasks.keys()) cancel(name);
}

/**
 * Run fn once after a delay.
 * @param {string} label       Descriptive label for logging.
 * @param {() => Promise<void>} fn
 * @param {number} delayMs
 */
function runOnce(label, fn, delayMs) {
  log.debug(`Scheduling one-shot "${label}" in ${delayMs}ms`);
  setTimeout(async () => {
    try {
      await fn();
    } catch (err) {
      log.error(`One-shot "${label}" failed: ${err.message}`);
    }
  }, delayMs);
}

/**
 * Keep-alive: ping a page by evaluating a trivial expression every N minutes
 * so the WhatsApp / district.in session doesn't expire.
 *
 * @param {import('playwright').Page} page
 * @param {number} [intervalMs=5 * 60 * 1_000]  Default: every 5 minutes
 */
function scheduleKeepAlive(page, intervalMs = 5 * 60 * 1_000) {
  schedule(
    "keep-alive",
    async () => {
      try {
        await page.evaluate(() => document.title);
        log.debug(`[${ts()}] Keep-alive ping OK`);
      } catch {
        log.warn("Keep-alive ping failed — page may have closed.");
        cancel("keep-alive");
      }
    },
    intervalMs,
  );
}

module.exports = { schedule, cancel, cancelAll, runOnce, scheduleKeepAlive };
