import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp, mkdir, writeFile, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildNativeSessionImport, claudeProjectKey, nativeSessionImportCapability} from '../lib/agent-session-import.mjs';
import {createAgentConversations} from '../lib/agent-conversations.mjs';

const source = {id: 'codex', name: 'Codex'};
const target = {id: 'claude-code', root: '/tmp/aiyou-claude'};
const session = {id: 'source-session', title: 'Agent 迁移测试', cwd: '/tmp/aiyou-project', signature: 'source-signature',
  messages: [{id: 'one', role: 'user', text: '保留源会话，迁移到 Claude Code。', at: '2026-10-09T01:00:00Z'},
    {id: 'two', role: 'assistant', text: '已准备文字会话副本。', at: '2026-10-09T01:00:01Z'},
    {id: 'three', role: 'user', text: '再检查 Skills。', at: '2026-10-09T01:00:02Z'}]};
const build = (overrides = {}) => buildNativeSessionImport({session, source, target, now: () => Date.parse('2026-10-09T02:00:00Z'), ...overrides});

test('native import uses a separate stable UUID and a linked text-only transcript', () => {
  const result = build(), again = build();
  assert.equal(result.sessionId, again.sessionId);
  assert.match(result.sessionId, /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.notEqual(result.sessionId, session.id);
  assert.equal(result.createOnly, true);
  assert.deepEqual(result.bytes, again.bytes);
  const rows = result.bytes.toString().trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].customTitle, session.title);
  assert.equal(rows[1].parentUuid, null);
  assert.equal(rows[2].parentUuid, rows[1].uuid);
  assert.equal(rows[3].parentUuid, rows[2].uuid);
  assert.equal(rows[2].message.model, 'imported-from-codex');
  assert.equal(rows[1].aiyouImport.inheritedExecutionAuthority, false);
  assert.equal(rows[1].aiyouImport.sourceMessageId, 'one');
  assert.notEqual(build({session: {...session, signature: 'changed'}}).sessionId, result.sessionId);
  assert.notEqual(build({target: {...target, root: '/tmp/other-target'}}).sessionId, result.sessionId);
});

test('unsupported native targets or missing project return null; invalid payloads reject', () => {
  assert.equal(build({target: {...target, id: 'codex'}}), null);
  assert.equal(build({session: {...session, cwd: ''}}), null);
  assert.equal(nativeSessionImportCapability({id: 'codex'}).supported, false);
  assert.throws(() => build({session: {...session, messages: []}}), /文字消息/);
  assert.throws(() => build({target: {...target, root: 'relative'}}), /无效/);
  assert.throws(() => claudeProjectKey('/tmp/path\u0000'), /绝对项目目录/);
  assert.throws(() => build({session: {...session, messages: Array.from({length: 1001}, () => session.messages[0])}}), /1000/);
  assert.throws(() => build({session: {...session, messages: [{id: 'long', role: 'user', text: 'x'.repeat(8 * 1024 * 1024)}]}}), /8MiB/);
});

test('project keys preserve Claude directory encoding and bounded long names', () => {
  assert.equal(claudeProjectKey('/Users/demo/项目 A'), '-Users-demo----A');
  assert.equal(claudeProjectKey('C:\\Users\\demo\\Project'), 'C--Users-demo-Project');
  assert.ok(claudeProjectKey('/tmp/' + 'x'.repeat(230)).length < 215);
});

test('generated Claude native transcript is discoverable by the workspace reader', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'aiyou-native-import-')));
  try {
    const result = build({target: {...target, root}}), file = path.join(root, result.relativePath);
    await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, result.bytes, {flag: 'wx'});
    const conversations = createAgentConversations(), agent = {...target, root, name: 'Claude Code'};
    const listed = await conversations.list(agent), read = await conversations.read(agent, listed.sessions[0].id);
    assert.equal(listed.sessions.length, 1);
    assert.equal(read.title, session.title);
    assert.equal(read.cwd, session.cwd);
    assert.deepEqual(read.messages.map(message => [message.role, message.text]), session.messages.map(message => [message.role, message.text]));
    await assert.rejects(writeFile(file, result.bytes, {flag: 'wx'}), {code: 'EEXIST'});
  } finally {await rm(root, {recursive: true, force: true});}
});

test('official Claude SDK lists and reads converted history without invoking a model or CLI', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'aiyou-native-sdk-')));
  try {
    const cwd = path.join(root, 'project'), longCwd = path.join(root, 'long-project-' + 'x'.repeat(170));
    await mkdir(cwd); await mkdir(longCwd);
    const first = build({target: {...target, root}, session: {...session, cwd}});
    const second = build({target: {...target, root}, session: {...session, cwd: longCwd}});
    for (const result of [first, second]) {const file = path.join(root, result.relativePath); await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, result.bytes, {flag: 'wx'});}
    const script = `import assert from 'node:assert/strict';
      import {listSessions,getSessionMessages,getSessionInfo} from '@anthropic-ai/claude-agent-sdk';
      for(const [cwd,id,title,texts] of JSON.parse(process.argv[1])) {
        const list=await listSessions({dir:cwd});assert.equal(list.length,1);assert.equal(list[0].sessionId,id);assert.equal(list[0].customTitle,title);
        const info=await getSessionInfo(id,{dir:cwd});assert.equal(info.cwd,cwd);
        const messages=await getSessionMessages(id,{dir:cwd});assert.equal(messages.length,texts.length);
        assert.deepEqual(messages.map(m=>[m.type,m.message.content.map(p=>p.text||'').join('')]),texts);
      }
      console.log('official Claude SDK: 2 native sessions listed, all 6 messages read; no query/startup called');`;
    const fixtures = [first, second].map(result => [result.projectPath, result.sessionId, session.title, session.messages.map(message => [message.role, message.text])]);
    const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(fixtures)],
      {cwd: path.resolve(import.meta.dirname, '..'), env: {PATH: process.env.PATH, CLAUDE_CONFIG_DIR: root}, timeout: 15000});
    assert.match(stdout, /all 6 messages read/);
  } finally {await rm(root, {recursive: true, force: true});}
});
