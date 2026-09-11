import { rename as renameFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Windows readers/indexers can briefly deny replacement of an existing file.
// Retry the same atomic rename, never unlink the destination as a fallback.
export async function replaceFileAtomically(source, destination, {
  platform = process.platform, rename = renameFile, wait = delay,
} = {}) {
  const pauses = [25, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error?.code) || attempt >= pauses.length) throw error;
      await wait(pauses[attempt]);
    }
  }
}
