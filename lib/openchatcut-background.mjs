import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const REVISION = '5';
const execute = promisify(execFile);
const fail = message => Object.assign(new Error(message), { code: 'BACKGROUND_RUNTIME_FAILED' });

export function backgroundRuntimePaths(installed, root) {
  const key = createHash('sha256').update(`${REVISION}:${installed.appPath}`).digest('hex').slice(0, 20);
  const appPath = path.join(root, 'background', key, 'OpenChatCut Background.app');
  return { appPath, executable: path.join(appPath, 'Contents', 'MacOS', 'OpenChatCut') };
}

// Read only named, bounded files from the verified release; no archive paths
// become extraction destinations and the official application stays untouched.
export async function readAsarFiles(archive, names) {
  const file = await open(archive, 'r');
  try {
    const prefix = Buffer.alloc(8); await file.read(prefix, 0, 8, 0);
    const size = prefix.readUInt32LE(4);
    if (size < 8 || size > 32 * 1024 * 1024) throw fail('OpenChatCut ASAR header is invalid');
    const header = Buffer.alloc(size); await file.read(header, 0, size, 8);
    const length = header.readUInt32LE(4);
    if (length > size - 8) throw fail('OpenChatCut ASAR header is truncated');
    const tree = JSON.parse(header.subarray(8, 8 + length).toString('utf8'));
    const result = {};
    for (const name of names) {
      let entry = tree;
      for (const segment of name.split('/')) entry = entry?.files?.[segment];
      const offset = Number(entry?.offset), bytes = Number(entry?.size);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 16 * 1024 * 1024) throw fail(`OpenChatCut runtime file unavailable: ${name}`);
      const data = Buffer.alloc(bytes); const read = await file.read(data, 0, bytes, 8 + size + offset);
      if (read.bytesRead !== bytes) throw fail(`OpenChatCut runtime file truncated: ${name}`);
      result[name] = data.toString('utf8');
    }
    return result;
  } finally { await file.close(); }
}

export function backgroundMainSource(source) {
  const boot = source.lastIndexOf('async function boot() {');
  const windowStart = source.indexOf('  const initialBounds = resolveInitialDesktopWindowBounds(', boot);
  const windowEnd = source.indexOf('\n}\napp3.on("window-all-closed", () => app3.quit());', windowStart);
  if (boot < 0 || windowStart < boot || windowEnd < windowStart
    || !source.slice(windowStart, windowEnd).includes('await win.loadURL(`${origin}/`);')) throw fail('OpenChatCut version does not support the verified background adapter');
  // The same upstream server, storage, renderers and handlers run, with no
  // desktop main window and no smoke mode / watchdog / test profile.
  return source.slice(0, windowStart)
    + '  console.log("[aiyou-background] ready; desktopWindows=" + BrowserWindow4.getAllWindows().length);\n'
    + source.slice(windowEnd).replace('app3.on("window-all-closed", () => app3.quit());', 'app3.on("window-all-closed", () => {});')
      .replace('dialog2.showErrorBox("OpenChatCut \\u542F\\u52A8\\u5931\\u8D25 / failed to start", detail);', 'console.error("[aiyou-background] startup failed");');
}

async function backgroundArchive(source, destination, replacements) {
  const input = await open(source, 'r');
  let headerSize, tree, bodySize;
  try {
    const prefix = Buffer.alloc(8); await input.read(prefix, 0, 8, 0); headerSize = prefix.readUInt32LE(4);
    const header = Buffer.alloc(headerSize); await input.read(header, 0, headerSize, 8);
    tree = JSON.parse(header.subarray(8, 8 + header.readUInt32LE(4)).toString('utf8'));
    bodySize = (await input.stat()).size - 8 - headerSize;
  } finally { await input.close(); }
  let nextOffset = bodySize;
  for (const [name, data] of Object.entries(replacements)) {
    let node = tree;
    for (const part of name.split('/')) node = node.files[part];
    const blockSize = 4194304, blocks = [];
    for (let i = 0; i < data.length; i += blockSize) blocks.push(createHash('sha256').update(data.subarray(i, i + blockSize)).digest('hex'));
    Object.assign(node, { size: data.length, offset: String(nextOffset), integrity: {
      algorithm: 'SHA256', hash: createHash('sha256').update(data).digest('hex'), blockSize, blocks } });
    nextOffset += data.length;
  }
  const json = Buffer.from(JSON.stringify(tree));
  const header = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0); header.writeUInt32LE(json.length, 4); json.copy(header, 8);
  const prefix = Buffer.alloc(8); prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(header.length, 4);
  await writeFile(destination, Buffer.concat([prefix, header]));
  await pipeline(createReadStream(source, { start: 8 + headerSize }), createWriteStream(destination, { flags: 'a' }));
  const output = await open(destination, 'a');
  try { for (const data of Object.values(replacements)) await output.write(data); } finally { await output.close(); }
  return createHash('sha256').update(json).digest('hex');
}

export async function prepareBackgroundRuntime(installed, root, { execFileAsync = execute } = {}) {
  if (installed.version !== '0.2.16') throw fail('此 OpenChatCut 版本尚无验证过的后台启动适配。');
  const target = backgroundRuntimePaths(installed, root);
  try { if (JSON.parse(await readFile(path.join(target.appPath, '..', 'runtime.json'), 'utf8')).revision === REVISION) return target; } catch {}
  const sourceResources = path.join(installed.appPath, 'Contents', 'Resources');
  const files = await readAsarFiles(path.join(sourceResources, 'app.asar'), ['package.json', 'desktop-dist/app-main.mjs', 'desktop-dist/preload.cjs']);
  const stage = `${path.dirname(target.appPath)}-${randomUUID()}`;
  const appPath = path.join(stage, path.basename(target.appPath));
  const contents = path.join(appPath, 'Contents'), resources = path.join(contents, 'Resources');
  const app = path.join(resources, 'app');
  try {
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.join(app, 'desktop-dist'), { recursive: true });
    await copyFile(installed.executable, path.join(contents, 'MacOS', 'OpenChatCut'));
    // Preserve upstream paths and identity so it uses the existing project
    // store and single-instance lock, not a second data/profile directory.
    const archiveHash = await backgroundArchive(path.join(sourceResources, 'app.asar'), path.join(resources, 'app.asar'), {
      'desktop-dist/app-main.mjs': Buffer.from(backgroundMainSource(files['desktop-dist/app-main.mjs'])),
      'desktop-dist/main.mjs': Buffer.from('import {app} from "electron"; app.commandLine.appendSwitch("js-flags","--max-old-space-size=6144"); try { await import("./app-main.mjs"); } catch (error) { console.error("[aiyou-background] load failed:",error.stack || error.message); app.exit(1); }\n'),
    });
    let plist = await readFile(path.join(installed.appPath, 'Contents', 'Info.plist'), 'utf8');
    plist = plist.replace(/(<key>ElectronAsarIntegrity<\/key>[\s\S]*?<key>hash<\/key>\s*<string>)[a-f0-9]{64}(<\/string>)/, `$1${archiveHash}$2`)
      .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleIdentifier</key><string>app.aiyoucodex.openchatcut.background</string>')
      .replace(/<key>LSUIElement<\/key>\s*<(?:true|false)\s*\/>/, '');
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, '<key>LSUIElement</key><true/>\n</dict>\n</plist>');
    await writeFile(path.join(contents, 'Info.plist'), plist);
    // Electron resolves framework bundles to their containing app. A symlink
    // points it back at the official app and breaks the adapted app identity.
    await execFileAsync('/bin/cp', ['-cR', path.join(installed.appPath, 'Contents', 'Frameworks'), path.join(contents, 'Frameworks')], { timeout: 60000 });
    for (const name of ['dist', 'app.asar.unpacked', 'chrome-headless-shell', 'remotion-bundle', 'icon.icns']) {
      await symlink(path.join(sourceResources, name), path.join(resources, name));
    }
    await rm(app, { recursive: true, force: true });
    const signature = await execFileAsync('/usr/bin/codesign', ['-d', '--entitlements', ':-', installed.appPath], { timeout: 10000 });
    const entitlements = (signature.stdout || '').match(/<\?xml[\s\S]*<\/plist>/)?.[0];
    if (!entitlements) throw fail('无法读取官方 Electron 的运行权限。');
    const entitlementPath = path.join(stage, 'electron-entitlements.plist');
    await writeFile(entitlementPath, entitlements);
    await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', entitlementPath, appPath], { timeout: 30000 });
    await writeFile(path.join(stage, 'runtime.json'), JSON.stringify({ revision: REVISION, sourceApp: installed.appPath, upstreamVersion: installed.version, mode: 'server-without-desktop-window' }));
    await mkdir(path.dirname(stage), { recursive: true });
    await rename(stage, path.dirname(target.appPath));
    return target;
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}
