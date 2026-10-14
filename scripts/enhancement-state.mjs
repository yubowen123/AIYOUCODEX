#!/usr/bin/env node
import { isEnhancementEnabled, setEnhancementEnabled } from '../lib/enhancement-state.mjs';
const action = process.argv[2];
if (action === 'enable') await setEnhancementEnabled(true);
else if (action === 'status') process.exitCode = await isEnhancementEnabled() ? 0 : 2;
else throw new Error('Usage: enhancement-state.mjs enable|status');
