import assert from 'node:assert/strict';
import test from 'node:test';
import { openChatCutProcesses, ownedOpenChatCutProcesses, sameOpenChatCutProcessIdentity } from '../lib/openchatcut-process.mjs';

function procStat(pid, parentPid, startTime) {
  const fields = ['S', String(parentPid), ...Array(17).fill('0'), String(startTime), '0'];
  return `${pid} (OpenChatCut (worker)) ${fields.join(' ')}\n`;
}

test('Linux reads trusted executable paths and process birth times without command arguments', async () => {
  const reads = [], commands = [];
  const executables = new Map([[101, '/tmp/.mount_occ123/OpenChatCut'], [102, '/usr/bin/ffmpeg'], [103, '/other/OpenChatCut']]);
  const rows = await openChatCutProcesses({ platform: 'linux',
    execFileAsync: async (command, args) => { commands.push({ command, args }); return { stdout: ' 101\n 102\n 103\n' }; },
    readFileImpl: async filename => { reads.push(filename); const pid = Number(filename.split('/')[2]); return procStat(pid, pid === 102 ? 101 : 1, pid * 10); },
    readlinkImpl: async filename => executables.get(Number(filename.split('/')[2])),
  });
  assert.deepEqual(commands, [{ command: '/bin/ps', args: ['-axo', 'pid='] }]);
  assert.deepEqual(rows, [
    { pid: 101, parentPid: 1, startTime: '1010', executable: '/tmp/.mount_occ123/OpenChatCut' },
    { pid: 102, parentPid: 101, startTime: '1020', executable: '/usr/bin/ffmpeg' },
    { pid: 103, parentPid: 1, startTime: '1030', executable: '/other/OpenChatCut' },
  ]);
  assert.equal(reads.length, 6);
  assert.ok(reads.every(filename => filename.endsWith('/stat')));
});

test('Linux process discovery rejects reused PIDs, unreadable executables and relative names', async () => {
  let statReads = 0;
  const rows = await openChatCutProcesses({ platform: 'linux',
    execFileAsync: async () => ({ stdout: '101\n102\n103\n' }),
    readFileImpl: async filename => {
      const pid = Number(filename.split('/')[2]);
      return procStat(pid, 1, pid === 101 ? ++statReads : 1000);
    },
    readlinkImpl: async filename => {
      const pid = Number(filename.split('/')[2]);
      if (pid === 102) throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
      return pid === 103 ? 'OpenChatCut' : '/tmp/.mount_occ123/OpenChatCut';
    },
  });
  assert.deepEqual(rows, []);
});

test('Linux ownership uses exact installed paths or verified launch identities, never an application basename', () => {
  const installed = { executable: '/home/example/apps/OpenChatCut.AppImage', appPath: '/home/example/apps/OpenChatCut.AppImage' };
  const launched = { pid: 101, startTime: '1000', executable: '/tmp/.mount_occ123/OpenChatCut' };
  const rows = [{ ...launched, parentPid: 1 }, { pid: 102, parentPid: 101, startTime: '1010', executable: '/usr/bin/ffmpeg' },
    { pid: 103, parentPid: 1, startTime: '1000', executable: '/other/OpenChatCut' }];
  assert.deepEqual(ownedOpenChatCutProcesses(rows, installed, 'linux'), []);
  assert.deepEqual(ownedOpenChatCutProcesses(rows, installed, 'linux', [launched]).map(row => row.pid), [101, 102]);
  assert.deepEqual(ownedOpenChatCutProcesses(rows, installed, 'linux', [{ ...launched, startTime: '999' }]), []);
  assert.equal(sameOpenChatCutProcessIdentity(rows[0], { ...launched, startTime: '999' }, 'linux'), false);
  assert.equal(sameOpenChatCutProcessIdentity(rows[0], { ...launched, executable: '/other/OpenChatCut' }, 'linux'), false);
});

test('Windows discovery and ownership retain case-insensitive executable identity', async () => {
  const executable = 'C:\\Users\\Example\\OpenChatCut.exe';
  const rows = await openChatCutProcesses({ platform: 'win32', execFileAsync: async () => ({ stdout: JSON.stringify({
    ProcessId: 101, ParentProcessId: 1, ExecutablePath: executable,
  }) }) });
  assert.equal(rows[0].executable, executable);
  assert.deepEqual(ownedOpenChatCutProcesses(rows, { executable: executable.toLowerCase() }, 'win32'), rows);
});
