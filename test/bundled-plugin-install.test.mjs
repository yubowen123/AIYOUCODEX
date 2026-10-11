import assert from 'node:assert/strict';
import { access, cp, realpath, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUNDLED_MARKETPLACE, installBundledPlugins } from '../lib/bundled-plugin-install.mjs';
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.CODEX_CLI_PATH || 'codex';
let cliAvailable = false;
try { await run(cli, ['plugin', '--help']); cliAvailable = true; } catch {}

test('a real Codex profile discovers both lightweight MCP plugins, repeats installation safely and preserves disabled preference', {timeout:60000, skip:!cliAvailable && 'Requires Codex CLI with plugin support'}, async t => {
  const home = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'aiyou-plugin-profile-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const installRoot = path.join(home, 'install');
  await cp(path.join(root, 'plugins'), path.join(installRoot, 'plugins'), {recursive:true});
  const config = path.join(home, '.codex', 'config.toml');
  await mkdir(path.dirname(config),{recursive:true});
  const initial = '[mcp_servers.existing]\nurl = "https://example.invalid/mcp"\n\n[plugins."unrelated@other"]\nenabled = false\n';
  await writeFile(config, initial);
  const invoke = async args=> JSON.parse((await run(cli,args,{env:{...process.env,CODEX_HOME:path.dirname(config)},timeout:20000})).stdout);
  const first = await installBundledPlugins({home,installDir:installRoot,codexPath:cli});
  assert.equal(first.status,'installed');
  assert.deepEqual(first.installed.sort(), ['moke-aigc@aiyoucodex-bundled', 'openchatcut@aiyoucodex-bundled']);
  const after = await readFile(config,'utf8');
  assert.ok(after.includes(initial.trim()));
  const servers = await invoke(['mcp','list','--json']);
  const moke = servers.filter(s=>s.name==='moke');
  assert.equal(moke.length,1);
  assert.equal(moke[0].transport.url,'https://www.mokeaigc.ai/mcp');
  assert.equal(typeof moke[0].auth_status, 'string', 'Codex CLI versions report OAuth capability with different status labels');
  const openchatcut = servers.filter(server => server.name === 'openchatcut');
  assert.equal(openchatcut.length, 1);
  assert.equal(openchatcut[0].transport.type, 'stdio');
  assert.ok(openchatcut[0].transport.args.some(argument => argument.endsWith('/server/index.mjs')));
  assert.ok(!JSON.stringify(openchatcut[0]).includes('5199'), 'Native MCP only connects to our wrapper');
  const transport = openchatcut[0].transport;
  await access(transport.cwd);
  const portableNode = await realpath(process.execPath);
  if (transport.command === 'node') assert.ok(transport.env.PATH.startsWith(path.dirname(portableNode) + path.delimiter), 'Agent Plugins PATH begins with the portable runtime');
  else assert.equal(transport.command, portableNode, 'Legacy plugin resolves the installer Node rather than desktop PATH');
  assert.equal(JSON.parse(await readFile(path.join(root, 'plugins/openchatcut/.mcp.json'), 'utf8')).mcpServers.openchatcut.command, 'node', 'Published template stays portable');
  const discovery = await new Promise((resolve, reject) => {
    const child = spawn(transport.command, transport.args, { cwd: transport.cwd, env: { ...process.env, PATH: '', ...transport.env, CODEX_HOME: path.dirname(config) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native OpenChatCut stdio discovery timed out')); }, 5000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'installer-test', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
  });
  assert.equal(discovery.code, 0, discovery.stderr);
  const toolNames = discovery.stdout.trim().split('\n').map(line => JSON.parse(line)).find(message => message.id === 2).result.tools.map(tool => tool.name);
  assert.ok(toolNames.includes('openchatcut_start_editing'), 'The registered native transport actually starts the wrapper');
  const second = await installBundledPlugins({home,installDir:installRoot,codexPath:cli});
  assert.equal(second.status,'installed');
  assert.equal(await readFile(config,'utf8'),after,'No redundant config rewrite');
  // Existing same-name server keeps its exact native config; plugin must not duplicate it.
  await writeFile(config, after+'\n[mcp_servers.moke]\nurl = "https://www.mokeaigc.ai/mcp"\nscopes = ["openid", "skill:read", "prompt:read"]\n[mcp_servers.moke.oauth]\nclient_id = "s2sv99pil5qbkz3gajdr0"\n');
  const withServer = await readFile(config,'utf8');
  await installBundledPlugins({home,installDir:installRoot,codexPath:cli});
  assert.equal(await readFile(config,'utf8'),withServer);
  assert.equal((await invoke(['mcp','list','--json'])).filter(s=>s.name==='moke').length,1);
  const disabled = withServer.replace(/(\[plugins\."moke-aigc@aiyoucodex-bundled"\]\s*enabled = )true/,'$1false');
  assert.notEqual(disabled,withServer);
  await writeFile(config,disabled);
  const partlyDisabled = await installBundledPlugins({home,installDir:installRoot,codexPath:cli});
  assert.equal(partlyDisabled.status,'installed');
  assert.deepEqual(partlyDisabled.disabled, ['moke-aigc@aiyoucodex-bundled']);
  assert.equal(await readFile(config,'utf8'),disabled);
  const bothDisabled = disabled.replace(/(\[plugins\."openchatcut@aiyoucodex-bundled"\]\s*enabled = )true/,'$1false');
  assert.notEqual(bothDisabled, disabled);
  await writeFile(config, bothDisabled);
  assert.equal((await installBundledPlugins({home,installDir:installRoot,codexPath:cli})).status,'disabled-by-user');
  assert.equal(await readFile(config,'utf8'),bothDisabled);
  assert.equal((await installBundledPlugins({home,installDir:installRoot,codexPath:cli,remove:true})).status,'removed');
  const removed = await readFile(config,'utf8');
  assert.ok(removed.includes(initial.trim()), 'Other connections and plugins survive uninstall');
  assert.ok(removed.includes('[mcp_servers.moke]'), 'Existing MOKE server survives uninstall');
  assert.ok(!removed.includes('[plugins."moke-aigc@aiyoucodex-bundled"]'));
  assert.ok(!removed.includes('[plugins."openchatcut@aiyoucodex-bundled"]'));
  assert.ok(!(await invoke(['plugin','marketplace','list','--json'])).marketplaces.some(m=>m.name==='aiyoucodex-bundled'));
});

async function fakeProfile(t, { installed = [], sourceChanged = false } = {}) {
  const installDir = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'bundled-plugin-unit-'));
  t.after(() => rm(installDir, { recursive: true, force: true }));
  const source = path.join(installDir, 'plugins');
  await mkdir(path.join(source, '.agents', 'plugins'), { recursive: true });
  await writeFile(path.join(source, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: BUNDLED_MARKETPLACE,
    plugins: ['moke-aigc', 'openchatcut'].map(name => ({ name, source: { source: 'local', path: `./${name}` } })) }));
  for (const name of ['moke-aigc', 'openchatcut']) {
    await mkdir(path.join(source, name));
    await writeFile(path.join(source, name, 'plugin.json'), JSON.stringify({ name, version: '2.0.0' }));
  }
  const state = { root: sourceChanged ? path.join(installDir, 'previous-plugins') : source,
    installed: installed.map(plugin => ({ pluginId: `${plugin.name}@${BUNDLED_MARKETPLACE}`, ...plugin })), mutations: [] };
  const run = async (_executable, args) => {
    let result = {};
    if (args[1] === '--help') return { stdout: '' };
    if (args[1] === 'marketplace' && args[2] === 'list') result = { marketplaces: state.root ? [{ name: BUNDLED_MARKETPLACE, root: state.root }] : [] };
    else if (args[1] === 'list') result = { installed: structuredClone(state.installed), available: [] };
    else {
      state.mutations.push(args);
      if (args[1] === 'marketplace') state.root = args[2] === 'remove' ? null : args[3];
      else if (args[1] === 'remove') state.installed = state.installed.filter(plugin => plugin.pluginId !== args[2]);
      else if (args[1] === 'add') {
        const name = args[2].split('@')[0];
        state.installed = state.installed.filter(plugin => plugin.name !== name);
        state.installed.push({ name, pluginId: args[2], version: '2.0.0', enabled: true });
      } else throw new Error(`Unexpected CLI call: ${args.join(' ')}`);
    }
    return { stdout: JSON.stringify(result) };
  };
  return { installDir, home: installDir, codexPath: 'fake-codex', run, state };
}

test('a disabled older plugin does not block installation or upgrades of its bundled neighbor', async t => {
  const fixture = await fakeProfile(t, { installed: [{ name: 'moke-aigc', version: '1.0.0', enabled: false }] });
  const result = await installBundledPlugins(fixture);
  assert.equal(result.status, 'installed');
  assert.deepEqual(result.disabled, ['moke-aigc@aiyoucodex-bundled']);
  assert.equal(result.plugins.find(plugin => plugin.name === 'openchatcut').application, 'install-on-demand');
  assert.deepEqual(fixture.state.mutations.filter(args => args[1] === 'add').map(args => args[2]), ['openchatcut@aiyoucodex-bundled']);
  assert.equal(fixture.state.installed.find(plugin => plugin.name === 'moke-aigc').enabled, false);
});

test('disabled OpenChatCut stays disabled while MOKE is updated', async t => {
  const fixture = await fakeProfile(t, { installed: [{ name: 'openchatcut', version: '1.0.0', enabled: false }, { name: 'moke-aigc', version: '1.0.0', enabled: true }] });
  const result = await installBundledPlugins(fixture);
  assert.deepEqual(result.disabled, ['openchatcut@aiyoucodex-bundled']);
  assert.deepEqual(fixture.state.mutations.filter(args => args[1] === 'add').map(args => args[2]), ['moke-aigc@aiyoucodex-bundled']);
});

test('uninstall preserves user-added plugins in a shared bundled marketplace', async t => {
  const fixture = await fakeProfile(t, { installed: ['moke-aigc', 'openchatcut', 'user-extra'].map(name => ({ name, version: '1.0.0', enabled: true })) });
  const result = await installBundledPlugins({ ...fixture, remove: true });
  assert.equal(result.status, 'removed');
  assert.equal(result.marketplacePreserved, true);
  assert.deepEqual(fixture.state.installed.map(plugin => plugin.name), ['user-extra']);
  assert.ok(!fixture.state.mutations.some(args => args[1] === 'marketplace' && args[2] === 'remove'));
});

test('a shared marketplace from another source is left intact during an update', async t => {
  const fixture = await fakeProfile(t, { sourceChanged: true, installed: [{ name: 'user-extra', version: '1.0.0', enabled: true }] });
  const result = await installBundledPlugins(fixture);
  assert.equal(result.status, 'source-conflict');
  assert.deepEqual(fixture.state.mutations, []);
});
