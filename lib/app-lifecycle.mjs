export const APP_LIFECYCLE_BINDING = "__AIYOUCODEX_APP_REQUEST__";

function exitError(message) {
  return Object.assign(new Error(message), { code: "APP_EXIT_ERROR" });
}

export function createAppLifecycleController({
  desktopRuntime,
  platform = process.platform,
  port = 9231,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 50,
} = {}) {
  let pending = null;
  let quitTarget = null;
  let closed = false;
  const supported = platform === "darwin" || platform === "win32";

  function shouldRecover(app) {
    // An explicitly reopened host resumes ordinary recovery. An absent or
    // still-closing host must never become an automatic relaunch request.
    if (quitTarget && app && app.pid !== quitTarget.pid) {
      quitTarget = null;
      closed = false;
    }
    return !quitTarget;
  }

  async function observeRunningHost() {
    if (quitTarget && !pending) shouldRecover(await desktopRuntime.readProcess());
  }

  async function quit() {
    if (!supported) throw exitError("当前平台暂不支持退出应用。");
    const app = await desktopRuntime.readProcess();
    if (!app && closed) return { closed: true };
    if (!app || app.debuggingPort !== port) {
      throw exitError("未找到当前 AIYOUcodex 应用，请重新打开设置后重试。");
    }
    quitTarget = app;
    closed = false;
    try {
      await desktopRuntime.quit(app);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const current = await desktopRuntime.readProcess();
        if (!current || current.pid !== app.pid) {
          closed = true;
          return { closed: true };
        }
        await wait(200);
      }
      throw exitError("应用尚未退出，请处理应用内提示后重试。");
    } catch (error) {
      quitTarget = null;
      closed = false;
      throw error?.code === "APP_EXIT_ERROR" ? error : exitError("退出未完成，请稍后重试。");
    }
  }

  function request(payload) {
    if (payload?.action === "snapshot") return { supported };
    if (payload?.action !== "quit") throw exitError("不支持此应用操作。");
    // One exit operation serves simultaneous requests from multiple windows.
    if (!pending) pending = quit().finally(() => { pending = null; });
    return pending;
  }

  return { request, shouldRecover, observeRunningHost };
}
