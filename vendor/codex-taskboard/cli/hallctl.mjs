#!/usr/bin/env node
import { closeSync, constants, fstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createTaskHall } from '../server/task-hall.mjs';

const commands = {
  enroll: ['id', 'name', 'host', 'role', 'credential'],
  list: ['project'],
  status: ['project'],
  inbox: ['credential', 'project'],
  tasks: ['credential', 'project'],
  heartbeat: ['credential'],
  claim: ['credential', 'task', 'revision'],
  handoff: ['credential', 'task', 'revision', 'to', 'evidence', 'evidence-file'],
  submit: ['credential', 'task', 'revision', 'evidence', 'evidence-file'],
  review: ['credential', 'task', 'revision', 'verdict', 'evidence', 'evidence-file'],
};
const usage = `AIYOU 任务大厅 · 本机 Agent 客户端
  hallctl enroll --id ID --name NAME --host codex|dsh|claude|local [--role worker|reviewer] --credential FILE
  hallctl list [--project ID]
  hallctl inbox --credential FILE [--project ID]
  hallctl heartbeat --credential FILE
  hallctl claim --credential FILE --task ID --revision N
  hallctl handoff --credential FILE --task ID --revision N --to AGENT --evidence-file FILE
  hallctl submit --credential FILE --task ID --revision N --evidence-file FILE
  hallctl review --credential FILE --task ID --revision N --verdict pass|changes --evidence-file FILE
`;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function required(values, key) {
  if (!values[key]) fail('请提供 --' + key);
  return values[key];
}
function readProtected(filename, limit = 8192, secret = false) {
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) fail('文件类型或大小不符合要求');
    if (secret && process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) fail('Agent 凭证文件须由当前用户独享（0600）');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
function evidence(values) {
  if (Boolean(values.evidence) === Boolean(values['evidence-file'])) fail('请选择 --evidence 或 --evidence-file 之一');
  return values.evidence || readProtected(values['evidence-file'], 16384);
}
function readCredential(filename) {
  try { return JSON.parse(readProtected(filename, 8192, true)); }
  catch (error) { if (error.status) throw error; fail('无法读取 Agent 凭证文件'); }
}
function main([command, ...args]) {
  if (!command || command === '--help' || command === 'help') { process.stdout.write(usage); return; }
  if (!Object.hasOwn(commands, command)) fail('未知命令；使用 hallctl --help');
  const { values } = parseArgs({ args, options: Object.fromEntries(commands[command].map(key => [key, { type: 'string' }])) });
  const hall = createTaskHall();
  try {
    if (command === 'status' || command === 'list') return hall.listOperator(values.project);
    if (command === 'enroll') {
      const filename = required(values, 'credential');
      const fields = { id: required(values, 'id'), name: required(values, 'name'), host: required(values, 'host'), role: values.role };
      // Never overwrite another worker's identity file or echo a secret.
      const fd = openSync(filename, 'wx', 0o600);
      try {
        const { key, ...record } = hall.register(fields);
        writeFileSync(fd, JSON.stringify({ id: record.id, key }) + '\n');
        return { agent: { ...record, online: false }, credentialWritten: true };
      } catch (error) {
        try { unlinkSync(filename); } catch {}
        throw error;
      } finally { closeSync(fd); }
    }
    const credential = readCredential(required(values, 'credential'));
    if (command === 'tasks' || command === 'inbox') return hall.listAgent(credential, values.project);
    if (command === 'heartbeat') return hall.heartbeat(credential);
    const action = { action: command, taskId: required(values, 'task'), revision: Number(required(values, 'revision')) };
    if (command !== 'claim') action.evidence = evidence(values);
    if (command === 'handoff') action.agentId = required(values, 'to');
    if (command === 'review') action.verdict = required(values, 'verdict');
    return hall.asAgent(credential, action);
  } finally { hall.close(); }
}
try {
  const result = main(process.argv.slice(2));
  if (result) process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: { message: error.status ? error.message : '无法执行本机任务大厅命令', status: error.status || 500 } }) + '\n');
  process.exitCode = error.status === 409 ? 5 : 1;
}
