#!/usr/bin/env node
import {runModelProxy} from '../lib/codex-model-proxy.mjs';

try {
  process.exitCode = await runModelProxy();
} catch (error) {
  // Startup errors contain only controlled operational text, never credentials.
  process.stderr.write('AIYOUcodex model adapter could not start the native Codex process.\n');
  process.exitCode = 1;
}
