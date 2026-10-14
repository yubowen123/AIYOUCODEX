import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { connectFixtureBrowser } from './helpers/browser-state.mjs';

test('dense search cards contain metadata, hit summaries and footers without changing preview ratios', { timeout: 30000 }, async t => {
  const outputRoot = process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || process.env.AIYOU_TEST_OUTPUT || os.tmpdir();
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(path.join(outputRoot, 'asset-search-layout-'));
  let browser, client, server;
  t.after(async () => {
    client?.close();
    if (browser && browser.exitCode === null && browser.signalCode === null) { const exited = once(browser, 'exit'); browser.kill('SIGTERM'); await exited; }
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
  let executable; for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  assert.ok(executable, 'Isolated Chrome is required for the card geometry regression');
  const css = await readFile(new URL('../vendor/codex-workspace-enhancer/asset-browser/public/ui-v3.css', import.meta.url), 'utf8');
  const summary = `<p class="asset-search-match"><span class="asset-search-label">命中资料</span><span class="asset-search-snippet">${'人物设定与角色关系，已有资料里的服饰和场景标签。'.repeat(12)}</span></p>`;
  const common = '<header class="asset-card-header"><div><span class="asset-format">MD</span><h3>01-角色分析和人物小传生成专家</h3></div><details class="asset-menu"><summary>•••</summary></details></header><div class="asset-meta"><span>23.1 KB</span><span>7月8日</span></div><div class="classification-line"><span>文档</span><span>本地规则 · 0 Token</span></div><div class="asset-tags"><span class="asset-tag">人物设定</span></div>';
  const textCard = `<article class="asset-card text-card">${common}${summary}<div class="text-card-preview">${'正文预览内容和人物参考资料。'.repeat(30)}</div><div class="card-hint">双击预览详情 · 卡片内可滚动</div></article>`;
  const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#aac"/></svg>')}`;
  const imageCard = `<article class="asset-card image-card"><figure class="media-frame"><img src="${svg}"></figure>${common}${summary}</article>`;
  const html = `<!doctype html><html style="--thumb-size:96px"><head><style>${css}</style></head><body data-library-view="thumbnail"><div class="asset-grid">${textCard.repeat(12)}${imageCard}<article class="asset-card text-card" id="ordinary">${common}<div class="text-card-preview">普通预览</div><div class="card-hint">双击预览详情</div></article></div></body></html>`;
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(root, 'browser');
  browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1440,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  const geometry = await client.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.asset-card:has(.asset-search-match)')];
    const outside = cards.flatMap((card,index) => [...card.querySelectorAll('.asset-card-header,.asset-meta,.asset-tags,.asset-search-match,.card-hint')].flatMap(node => {
      const c=card.getBoundingClientRect(),r=node.getBoundingClientRect();
      return r.width&&r.height&&(r.top<c.top-1||r.bottom>c.bottom+1||r.left<c.left-1||r.right>c.right+1)?[{index,className:node.className,card:{top:c.top,bottom:c.bottom},child:{top:r.top,bottom:r.bottom}}]:[];
    }));
    const frame=document.querySelector('.image-card .media-frame').getBoundingClientRect();
    return {outside,width:cards[0].getBoundingClientRect().width,ordinaryHeight:document.getElementById('ordinary').getBoundingClientRect().height,
      previewRatio:frame.width/frame.height,lines:cards.map(card=>getComputedStyle(card.querySelector('.asset-search-snippet')).webkitLineClamp)};
  })()`);
  assert.deepEqual(geometry.outside, [], JSON.stringify(geometry));
  assert.ok(geometry.width < 120, 'Density 7 stays compact');
  assert.equal(geometry.ordinaryHeight, 300, 'Unsearched text cards retain their existing layout');
  assert.ok(Math.abs(geometry.previewRatio - 0.75) < 0.02, JSON.stringify(geometry));
  assert.ok(geometry.lines.every(value => Number(value) >= 2 && Number(value) <= 3));
});
