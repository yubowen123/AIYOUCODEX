#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readResetAnnouncements, recordResetCheck, resetAnnouncementPath } from "../lib/reset-announcements.mjs";
import { collectResetRss } from "../lib/reset-rss.mjs";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "status" && !args.length) {
    console.log(JSON.stringify({ path: resetAnnouncementPath(), ...await readResetAnnouncements() }, null, 2));
  } else if (command === "collect" && !args.length) {
    try { console.log(JSON.stringify(await collectResetRss(), null, 2)); }
    catch (error) {
      await recordResetCheck({ status: "error", message: error.message, events: [] });
      throw error;
    }
  } else if (command === "record" && args.length === 2 && args[0] === "--file") {
    const input = await readFile(args[1], "utf8");
    if (Buffer.byteLength(input) > 128 * 1024) throw new Error("Check input is too large");
    const state = await recordResetCheck(JSON.parse(input));
    console.log(JSON.stringify({ ok: true, path: resetAnnouncementPath(), checkStatus: state.checkStatus, events: state.events.length }));
  } else {
    throw new Error("Usage: node scripts/reset-announcements.mjs status | collect | record --file <check.json>");
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
