import {constants} from 'node:fs';
import {lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const queues = new Map();
const KEY_FORMAT = /^sk-[A-Za-z0-9]{16,253}$/;
const ERROR_MESSAGE = 'DeepSeek 凭证设置失败，请检查 API Key 和本地凭证文件。';
const settingsError = () => Object.assign(new Error(ERROR_MESSAGE), {code: 'DEEPSEEK_SETTINGS_ERROR'});

function validKey(value) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && KEY_FORMAT.test(value);
}

export function deepSeekCredentialPath({home = os.homedir(), env = process.env} = {}) {
  return path.resolve(env.CODEX_HOME || path.join(home, '.codex'), 'keys.md');
}

async function rejectUnsafeFile(filename) {
  try {
    const info = await lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) throw settingsError();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function readCredentialFile(filename) {
  await rejectUnsafeFile(filename);
  let handle;
  let text = '';
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!(await handle.stat()).isFile()) throw settingsError();
    text = await handle.readFile('utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally { await handle?.close(); }
  const assignments = [...text.matchAll(/^[\t ]*DEEPSEEK_API_KEY[\t ]*=[^\r\n]*/gm)];
  if (assignments.length > 1) throw settingsError();
  const assignment = assignments[0];
  return {text, assignment, key: assignment?.[0].slice(assignment[0].indexOf('=') + 1).trim()};
}

/** Used only by the native provider auth subprocess; never expose through a UI bridge. */
export async function readDeepSeekCredential({home = os.homedir(), env = process.env} = {}) {
  try {
    if (env.DEEPSEEK_API_KEY) {
      if (!validKey(env.DEEPSEEK_API_KEY)) throw settingsError();
      return env.DEEPSEEK_API_KEY;
    }
    const {key} = await readCredentialFile(deepSeekCredentialPath({home, env}));
    if (!validKey(key)) throw settingsError();
    return key;
  } catch { throw settingsError(); }
}

function snapshot(environment, file) {
  if (file.key && !validKey(file.key)) throw settingsError();
  const fileConfigured = validKey(file.key);
  const source = environment ? 'environment' : fileConfigured ? 'file' : null;
  return {configured: source !== null, source, fileConfigured, environmentOverrides: Boolean(environment)};
}

async function saveCredential(filename, apiKey, file) {
  const directory = path.dirname(filename);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const line = `DEEPSEEK_API_KEY=${apiKey}`;
  const text = file.assignment
    ? file.text.slice(0, file.assignment.index) + line + file.text.slice(file.assignment.index + file.assignment[0].length)
    : file.text + (file.text && !file.text.endsWith('\n') ? '\n' : '') + line + '\n';
  const temporary = path.join(directory, `.keys.md.deepseek-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rejectUnsafeFile(filename);
    await rename(temporary, filename);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Only redacted status crosses the settings bridge; secrets remain in keys.md. */
export function createDeepSeekSettingsController({home = os.homedir(), env = process.env} = {}) {
  const filename = deepSeekCredentialPath({home, env});
  async function execute(payload) {
    try {
      if (!payload || !['snapshot', 'save'].includes(payload.action)) throw settingsError();
      if (payload.action === 'save' && !validKey(payload.apiKey)) throw settingsError();
      const environment = env.DEEPSEEK_API_KEY;
      if (environment && !validKey(environment)) throw settingsError();
      const file = await readCredentialFile(filename);
      if (payload.action === 'save') {
        await saveCredential(filename, payload.apiKey, file);
        return snapshot(environment, {key: payload.apiKey});
      }
      return snapshot(environment, file);
    } catch { throw settingsError(); }
  }
  return {request(payload) {
    // Shared across controller instances for the same local credential file.
    const pending = (queues.get(filename) || Promise.resolve()).catch(() => {}).then(() => execute(payload));
    queues.set(filename, pending);
    const cleanup = () => { if (queues.get(filename) === pending) queues.delete(filename); };
    pending.then(cleanup, cleanup);
    return pending;
  }};
}
