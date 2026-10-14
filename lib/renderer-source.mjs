import { createHash } from 'node:crypto';

const PART_CHARS = 256 * 1024;
const DIRECT_BYTES = 512 * 1024;
const STORAGE = '__AIYOUCODEX_RENDERER_SOURCE_PARTS__';

// Theme catalogs may contain large local media data URLs. CDP's WebSocket
// rejects one oversized frame, so transfer the exact program in bounded parts.
// No CSP/origin setting, asset contents or theme selection changes here.
export function rendererScriptParts(source) {
  if (typeof source !== 'string') throw new TypeError('Renderer source must be a string');
  if (Buffer.byteLength(source) <= DIRECT_BYTES) return [source];
  const key = JSON.stringify(createHash('sha256').update(source).digest('hex'));
  const parts = [];
  for (let offset = 0; offset < source.length; offset += PART_CHARS) parts.push(source.slice(offset, offset + PART_CHARS));
  return [
    `if(window.top===window){(window.${STORAGE}||={})[${key}]=[];}`,
    ...parts.map(part => `if(window.top===window){window.${STORAGE}?.[${key}]?.push(${JSON.stringify(part)});}`),
    `if(window.top===window){const store=window.${STORAGE},parts=store?.[${key}];if(store){delete store[${key}];if(!Object.keys(store).length)delete window.${STORAGE};}if(!parts||parts.length!==${parts.length})throw Error("Renderer source transfer incomplete");(0,eval)(parts.join(""));}`,
  ];
}

export async function removeRendererScripts(client, identifiers, { except = [] } = {}) {
  const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
  const retained = new Set(except);
  for (const identifier of ids) if (typeof identifier === 'string' && identifier && !retained.has(identifier)) {
    await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
}

export async function registerRendererSource(client, source) {
  const identifiers = [];
  try {
    for (const part of rendererScriptParts(source)) {
      const result = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: part });
      identifiers.push(result.identifier);
    }
    return identifiers;
  } catch (error) {
    await removeRendererScripts(client, identifiers);
    throw error;
  }
}

export async function evaluateRendererSource(client, source) {
  const previousTimeout = client.requestTimeoutMs;
  // Reconstruction executes the same trusted program; a large local theme
  // can take longer to compile than an ordinary health/readiness expression.
  client.requestTimeoutMs = Math.max(previousTimeout || 0, 30_000);
  try {
    let result;
    for (const part of rendererScriptParts(source)) result = await client.evaluate(part);
    return result;
  } finally {
    client.requestTimeoutMs = previousTimeout;
  }
}
