import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Read executable paths, never command-line arguments (which may contain secrets).
export async function openChatCutProcesses({ platform = process.platform, execFileAsync = execute,
  readFileImpl = readFile, readlinkImpl = readlink } = {}) {
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress'], { timeout: 5000 });
    const value = JSON.parse(stdout || '[]');
    return (Array.isArray(value) ? value : [value]).map(row => ({ pid: row.ProcessId, parentPid: row.ParentProcessId, executable: row.ExecutablePath || '' }));
  }
  if (platform === 'linux') {
    // Linux's comm is only a name. /proc supplies the executable and start time
    // without exposing argv; the second stat read rejects a reused PID.
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid='], { timeout: 5000 });
    const pids = [...new Set(stdout.trim().split(/\s+/u).map(Number))].filter(pid => Number.isInteger(pid) && pid > 1);
    return (await Promise.all(pids.map(async pid => {
      try {
        const parse = value => {
          const end = value.lastIndexOf(') ');
          const fields = end >= 0 ? value.slice(end + 2).trim().split(/\s+/u) : [];
          const parentPid = Number(fields[1]), startTime = fields[19];
          if (!value.startsWith(`${pid} (`) || !Number.isInteger(parentPid) || parentPid < 0 || !/^[1-9]\d*$/u.test(startTime || '')) throw new Error('Invalid process identity');
          return { parentPid, startTime };
        };
        const before = parse(await readFileImpl(`/proc/${pid}/stat`, 'utf8'));
        const executable = await readlinkImpl(`/proc/${pid}/exe`);
        const after = parse(await readFileImpl(`/proc/${pid}/stat`, 'utf8'));
        if (before.startTime !== after.startTime || !executable.startsWith('/')) return null;
        return { pid, ...after, executable };
      } catch { return null; } // Exited or unreadable processes cannot become owned.
    }))).filter(Boolean);
  }
  const { stdout } = await execFileAsync('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,comm='], { timeout: 5000 });
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), executable: match[3] }] : [];
  });
}

export function sameOpenChatCutProcessIdentity(left, right, platform = process.platform) {
  const normalize = value => platform === 'win32' ? value?.toLowerCase().replaceAll('\\', '/') : value;
  return left?.pid === right?.pid && typeof left?.executable === 'string'
    && normalize(left.executable) === normalize(right?.executable)
    && (platform !== 'linux' || /^[1-9]\d*$/u.test(left.startTime || '') && left.startTime === right?.startTime);
}

export function ownedOpenChatCutProcesses(rows, installed, platform = process.platform, launchRecords = []) {
  const normalize = value => platform === 'win32' ? value.toLowerCase().replaceAll('\\', '/') : value;
  const executables = [installed.executable, installed.backgroundExecutable].filter(Boolean).map(normalize);
  const apps = [installed.appPath, installed.backgroundAppPath].filter(Boolean).map(normalize);
  const roots = rows.filter(row => executables.includes(normalize(row.executable))
    || platform === 'linux' && launchRecords.some(record => sameOpenChatCutProcessIdentity(row, record, platform)));
  const owned = new Set(roots.map(row => row.pid));
  // macOS helper paths identify surviving children after their parent exits.
  if (platform === 'darwin') for (const row of rows) {
    if (apps.some(app => normalize(row.executable).startsWith(`${app}/Contents/Frameworks/`))) owned.add(row.pid);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (owned.has(row.parentPid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
  }
  return rows.filter(row => owned.has(row.pid) && row.pid > 1 && row.pid !== process.pid);
}

// AppKit hides only this installed application without activating it or using
// System Events / accessibility automation. LaunchServices' -j is also retained.
export async function hideOpenChatCutApplication(installed, { platform = process.platform, execFileAsync = execute,
  listProcesses = () => openChatCutProcesses({ platform, execFileAsync }) } = {}) {
  if (platform !== 'darwin' || !installed?.appPath) return;
  const roots = (await listProcesses()).filter(row => row.executable === installed.executable);
  if (!roots.length) throw Object.assign(new Error('未找到已安装的 OpenChatCut 后台进程，未隐藏其他应用。'), { code: 'BACKGROUND_PROCESS_NOT_FOUND' });
  const script = 'ObjC.import("AppKit"); function run(args) { let hidden = 0; for (const pid of args) { let stable = 0; for (const deadline = Date.now() + 4000; Date.now() < deadline;) { const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(pid)); app.hide; $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1)); stable = app.isHidden ? stable + 1 : 0; if (stable >= 3) { hidden++; break; } } } if (!hidden) throw new Error("OpenChatCut background window could not be hidden"); return hidden; }';
  await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...roots.map(row => String(row.pid))], { timeout: 8000 });
}
