#!/usr/bin/env node
import {readDeepSeekCredential} from '../lib/deepseek-settings.mjs';

// The native provider captures stdout as a bearer token. Never run this as a
// diagnostic command, log its output, or return it through the renderer bridge.
if (process.argv[2] !== '--codex-auth') {
  process.stderr.write('This helper is reserved for the native DeepSeek provider.\n');
  process.exitCode = 1;
} else {
  try {
    process.stdout.write((await readDeepSeekCredential()) + '\n');
  } catch {
    process.stderr.write('DeepSeek API Key unavailable. Save it in AIYOUcodex Settings → DeepSeek.\n');
    process.exitCode = 1;
  }
}
