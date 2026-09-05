export const MAX_MEDIA_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_RESPONSE_BYTES = 32 * 1024 * 1024;

export function boundedMediaRange(value, limit = MAX_MEDIA_CHUNK_BYTES) {
  if (!value) return null; // Server knows the MIME and caps only audio/video.
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return value;
  if (!match[1]) return `bytes=-${Math.min(Number(match[2]), limit)}`;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start + limit - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return value;
  return `bytes=${start}-${Math.min(end, start + limit - 1)}`;
}

export function assetResponseByteLimit(contentType = "") {
  return /^(audio|video)\//i.test(contentType) ? MAX_MEDIA_CHUNK_BYTES : MAX_ASSET_RESPONSE_BYTES;
}

export function createMediaRequestLimiter({ concurrency = 2, maxQueue = 256 } = {}) {
  let active = 0;
  const waiting = [];
  function drain() {
    while (active < concurrency && waiting.length) {
      const item = waiting.shift();
      item.signal?.removeEventListener("abort", item.abort);
      if (item.signal?.aborted) { item.reject(new Error("Media request cancelled")); continue; }
      active++;
      Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => { active--; drain(); });
    }
  }
  return function run(work, signal) {
    if (signal?.aborted) return Promise.reject(new Error("Media request cancelled"));
    if (waiting.length >= maxQueue) return Promise.reject(new Error("Too many pending media requests"));
    return new Promise((resolve, reject) => {
      const item = { work, signal, resolve, reject };
      item.abort = () => {
        const index = waiting.indexOf(item);
        if (index < 0) return;
        waiting.splice(index, 1);
        reject(new Error("Media request cancelled"));
      };
      signal?.addEventListener("abort", item.abort, { once: true });
      waiting.push(item);
      drain();
    });
  };
}
