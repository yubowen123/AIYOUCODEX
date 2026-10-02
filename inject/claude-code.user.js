(() => {
  "use strict";
  const KEY = "__aiyouClaudeInjection__", ENTRY = "aiyoucodex-agent-launchers", PANEL = "aiyoucodex-claude-panel";
  const BINDING = "__AIYOUCODEX_CLAUDE_REQUEST__";
  window[KEY]?.destroy?.();
  let row, source, panel, data, projectId = "", sessionId = "", polling, destroyed = false, inFlight = false;
  const requests = new Map(), skillIds = new Set(), mcpIds = new Set();
  let resourcesSignature = "", messagesSignature = "";
  let persona = { name: "Claude Code", logo: "", description: "", revision: 0 }, logoDraft = "", logoLoading = false;
  const dotHeaders = new Set();
  const panelHosts = new Set();
  let personaLoaded = false, personaLoading = false, personaRetryAt = 0;
  const style = document.createElement("style");
  style.id = "aiyoucodex-claude-style";
  style.textContent = `
    [data-aiyou-dot-source]{display:none!important}
    body[data-aiyou-claude-active] [data-aiyou-dot-header],body[data-aiyou-claude-active] [data-aiyou-dot-header] *{visibility:hidden!important;pointer-events:none!important}
    body[data-aiyou-claude-active] [data-aiyou-claude-host]{position:relative!important}
    #${ENTRY}{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin:8px 0 12px;-webkit-app-region:no-drag}
    #${ENTRY} button{display:flex!important;align-items:center;justify-content:center;gap:8px;width:100%!important;min-width:0;height:44px!important;min-height:44px;border:1px solid #80808015!important;border-radius:12px;padding:10px!important;color:#595959!important;background:color-mix(in srgb,Canvas 94%,transparent)!important;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;letter-spacing:0;text-align:center;cursor:pointer;box-shadow:0 2px 6px #00000008,0 1px 2px #00000004;transition:box-shadow .15s,transform .15s,background .15s;-webkit-app-region:no-drag}
    #${ENTRY} button:hover{box-shadow:0 4px 12px #00000010,0 1px 3px #00000008;transform:translateY(-1px)}
    #${ENTRY} button:focus-visible{outline:2px solid #328bfa;outline-offset:-2px}
    #${ENTRY} button[aria-expanded=true]{border-color:#80808030!important;background:color-mix(in srgb,Canvas 96%,#595959)!important}
    #${ENTRY} img,#${ENTRY} svg{width:17px;height:17px;flex-shrink:0}
    #${ENTRY} [data-claude-mark]{color:#595959;font-size:19px;line-height:18px}
    #${PANEL}{position:relative;z-index:40;display:flex;flex-direction:column;flex:0 0 var(--codex-workspace-panel-width,640px);width:var(--codex-workspace-panel-width,640px);min-width:min(360px,100%);max-width:min(100%,calc(100vw - 120px));height:100%;min-height:0;border-left:1px solid #80808030;background:Canvas;color:CanvasText;pointer-events:auto;-webkit-app-region:no-drag;font-size:13px;box-sizing:border-box}
    #${PANEL}[hidden]{display:none!important}#${PANEL} *{box-sizing:border-box}
    #${PANEL} header{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid #80808025;flex-shrink:0}#${PANEL} header strong{flex:1;font-size:16px}
    #${PANEL} button,#${PANEL} select,#${PANEL} input,#${PANEL} textarea{font:inherit;color:inherit;border:1px solid #80808035;border-radius:8px;background:Canvas;padding:7px 9px;min-height:32px;-webkit-app-region:no-drag}
    #${PANEL} button{cursor:pointer}#${PANEL} button:disabled{opacity:.5;cursor:default}#${PANEL} :focus-visible{outline:2px solid #328bfa;outline-offset:2px}
    #${PANEL} [data-claude-setup]{padding:12px 16px;display:grid;gap:8px;border-bottom:1px solid #80808025;max-height:42%;overflow:auto}
    #${PANEL} .claude-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}#${PANEL} select{width:100%;min-width:0}
    #${PANEL} summary{cursor:pointer;font-weight:600;padding:6px 0}#${PANEL} small{opacity:.66;font-size:11px}
    #${PANEL} [data-claude-skills],#${PANEL} [data-claude-mcps]{max-height:160px;overflow:auto;display:grid;gap:5px}#${PANEL} label{display:flex;align-items:center;gap:7px}#${PANEL} label input{min-height:0}
    #${PANEL} [data-claude-search]{width:100%;margin-bottom:7px}#${PANEL} [data-claude-status]{min-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
    #${PANEL} [data-claude-log]{flex:1;min-height:0;overflow:auto;padding:14px 16px;overscroll-behavior:contain}
    #${PANEL} article{padding:10px 12px;border-radius:12px;margin-bottom:10px;background:color-mix(in srgb,currentColor 4%,Canvas);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}
    #${PANEL} article[data-role=user]{background:color-mix(in srgb,#328bfa 9%,Canvas)}#${PANEL} article[data-role=tool]{font-size:11px;opacity:.66;background:transparent;padding:2px 4px}
    #${PANEL} [data-claude-permissions]{max-height:35%;overflow:auto;padding:0 16px}#${PANEL} [data-claude-permissions]:empty{display:none}#${PANEL} [data-permission]{padding:12px;border:1px solid #d79a3b70;border-radius:10px;margin:8px 0;background:#d79a3b0c}
    #${PANEL} pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto;font-size:11px}#${PANEL} [data-claude-compose]{padding:12px 16px;border-top:1px solid #80808025;display:grid;gap:8px;flex-shrink:0}#${PANEL} textarea{width:100%;resize:vertical;min-height:72px;max-height:200px}
    #${PANEL} .claude-actions{display:flex;align-items:center;gap:8px}#${PANEL} [data-claude-send]{background:#c07853;color:white;border-color:transparent;margin-left:auto}
    #${PANEL} [data-claude-setup]{padding:10px 20px;gap:5px;max-height:none}
    #${PANEL} [data-claude-path]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #${PANEL} [data-claude-status]{font-size:11px;color:#777}
    #${PANEL} [data-claude-log]{padding:24px clamp(20px,5%,48px)}
    #${PANEL} article{width:fit-content;max-width:90%;border-radius:19px;padding:10px 16px}
    #${PANEL} article[data-role=user]{margin-left:auto;background:#e8efed;color:#333}
    #${PANEL} article[data-role=tool]{max-width:100%}
    #${PANEL} article[data-welcome]{margin:14vh auto 0;background:none;text-align:center;max-width:330px;color:#777;font-size:12px}
    #${PANEL} article[data-welcome] strong{display:block;color:#595959;font-size:22px;font-weight:500;margin-bottom:10px}
    #${PANEL} [data-claude-compose]{position:relative;margin:0 20px 18px;padding:12px 14px;gap:6px;border:1px solid #80808025;border-radius:22px;box-shadow:0 3px 14px #00000006}
    #${PANEL} [data-claude-compose] textarea{min-height:52px;max-height:160px;border:0;background:transparent;resize:none;padding:4px 5px;outline:none}
    #${PANEL} [data-claude-compose] textarea:focus-visible{outline:none}
    #${PANEL} [data-claude-add],#${PANEL} [data-claude-send]{width:32px;height:32px;min-height:32px;padding:0;border:0;border-radius:50%;font-size:20px;line-height:1;background:transparent;color:#595959}
    #${PANEL} [data-claude-add]:hover{background:#80808012}
    #${PANEL} [data-claude-send]{background:#595959;color:white;margin-left:auto}
    #${PANEL} [data-claude-stop]{font-size:11px;padding:3px 7px;min-height:26px}
    #${PANEL} [data-claude-hint]{font-size:10px;opacity:.5}
    #${PANEL} [data-claude-references]{display:flex;flex-wrap:wrap;gap:5px}
    #${PANEL} [data-claude-references]:empty{display:none}
    #${PANEL} [data-claude-reference]{padding:3px 8px;min-height:24px;border-radius:12px;font-size:11px;background:#80808008;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${PANEL} [data-claude-reference-menu]{position:absolute;bottom:calc(100% + 10px);left:0;width:min(440px,100%);max-height:min(460px,60vh);padding:12px;overflow:auto;background:Canvas;border:1px solid #80808025;border-radius:16px;box-shadow:0 8px 32px #00000016;z-index:5}
    #${PANEL} [data-claude-reference-menu][hidden],#${PANEL} [data-claude-reference-menu] [hidden]{display:none!important}
    #${PANEL} [data-claude-reference-tabs]{display:flex;gap:6px;margin-bottom:10px}
    #${PANEL} [data-claude-reference-tabs] button{flex:1;border:0;background:#80808008;color:#595959}
    #${PANEL} [data-claude-reference-tabs] button[aria-selected=true]{background:#80808017}
    #${PANEL} [data-claude-skills],#${PANEL} [data-claude-mcps]{max-height:250px}
    #${PANEL} [data-claude-reference-menu] label{padding:7px 5px;border-radius:7px}
    #${PANEL} [data-claude-reference-menu] label:hover{background:#80808008}
    #${PANEL}{position:absolute;z-index:60;top:0;right:0;flex:none;width:min(var(--codex-workspace-panel-width,640px),100%);max-width:100%;overflow:hidden}
    #${PANEL} header{position:relative;justify-content:center;padding:14px 20px 12px;min-height:110px;border-bottom:0}
    #${PANEL} [data-claude-identity]{display:flex;flex-direction:column;align-items:center;gap:4px;padding:0;border:0;background:transparent;max-width:calc(100% - 160px);color:#595959}
    .claude-avatar{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px}
    .claude-avatar img,.claude-avatar svg{width:100%;height:100%;object-fit:contain;border-radius:22%;filter:drop-shadow(0 2px 3px #0000000a)}
    #${PANEL} [data-claude-identity] .claude-avatar{width:58px;height:58px}
    #${PANEL} [data-claude-name]{font-size:13px;line-height:20px;font-weight:500;border:1px solid #8080801a;border-radius:14px;padding:2px 12px;background:Canvas;box-shadow:0 1px 3px #00000005;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${PANEL} .claude-header-actions{position:absolute;right:16px;top:16px;display:flex;gap:6px}
    #${PANEL} .claude-header-actions button{border:1px solid #80808020;background:Canvas;color:#595959;min-width:30px;min-height:30px;border-radius:50%;padding:3px;font-size:16px;box-shadow:0 2px 6px #00000005}
    #${PANEL} [data-claude-setup]{padding:0 24px 12px;border-bottom:1px solid #80808014;gap:4px}
    #${PANEL} [data-claude-path]{display:none}
    #${PANEL} .claude-pair select{background:#80808004;border-color:#80808020;border-radius:10px;font-size:12px;min-height:30px}
    #${PANEL} [data-claude-log]{padding:22px max(24px,calc((100% - 760px)/2));font-size:13px;line-height:1.7}
    #${PANEL} article{border-radius:22px;background:color-mix(in srgb,CanvasText 4%,Canvas);margin-bottom:8px;max-width:92%;padding:12px 18px}
    #${PANEL} article[data-role=user]{background:#20b7a5;color:white}
    #${PANEL} article[data-role=tool]{background:none;color:#777;font-size:11px}
    #${PANEL} article[data-welcome]{margin:10vh auto 0;max-width:380px;padding:0;background:none;color:#888}
    #${PANEL} article[data-welcome] strong{font-size:19px;color:#595959;font-weight:500}
    #${PANEL} [data-claude-compose]{width:calc(100% - 48px);max-width:760px;align-self:center;margin:0 24px 18px;border-radius:28px;padding:10px 14px 8px;box-shadow:0 2px 10px #00000005}
    #${PANEL} [data-claude-compose] textarea{min-height:36px;max-height:160px;font-size:13px}
    #${PANEL} [data-claude-send]{background:#20b7a5;color:white}
    #${PANEL} [data-claude-reference-menu]{width:min(520px,100%);padding:12px;border-radius:22px;box-shadow:0 8px 28px #0000000f}
    #${PANEL} [data-claude-reference-menu] label{padding:9px 8px;gap:10px;border-radius:16px;font-weight:400}
    #${PANEL} [data-claude-reference-menu] label input{accent-color:#20b7a5}
    #${PANEL} [data-claude-persona]{position:absolute;z-index:8;top:112px;left:50%;transform:translateX(-50%);width:min(370px,calc(100% - 32px));max-height:calc(100% - 140px);overflow:auto;padding:18px;background:Canvas;border:1px solid #80808025;border-radius:22px;box-shadow:0 10px 35px #00000014;display:grid;gap:12px}
    #${PANEL} [data-claude-persona][hidden]{display:none!important}
    #${PANEL} [data-claude-persona] label{display:grid;gap:5px;font-size:12px;color:#595959}
    #${PANEL} [data-claude-persona] input,#${PANEL} [data-claude-persona] textarea{width:100%;padding:9px 10px;border-radius:10px;font-size:13px}
    #${PANEL} [data-claude-persona] textarea{min-height:90px;resize:vertical}
    #${PANEL} [data-claude-persona] input[type=file]{display:none}
    #${PANEL} .claude-persona-logo{display:flex;align-items:center;gap:12px}
    #${PANEL} .claude-persona-logo .claude-avatar{width:54px;height:54px}
    #${PANEL} .claude-persona-footer{display:flex;justify-content:flex-end;gap:8px}
    #${PANEL} [data-claude-persona-save]{background:#595959;color:white;border:0}
    #${PANEL} [data-claude-persona-error]{color:#b94c3d;font-size:12px;white-space:pre-wrap}
    #${PANEL} [data-claude-persona-error]:empty{display:none}
  `;
  document.head.append(style);
  const api = () => window.__codexConversationPreviewInjection__;
  const text = (selector, value) => { const node = panel?.querySelector(selector); if (node && node.textContent !== String(value || "")) node.textContent = value || ""; };
  function avatar(logo = persona.logo) {
    const node = document.createElement("span"); node.className = "claude-avatar"; node.setAttribute("aria-hidden", "true");
    if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(logo)) { const img = document.createElement("img"); img.src = logo; img.alt = ""; node.append(img); }
    else node.innerHTML = '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="56" height="56" rx="19" fill="#fbf4ef"/><g stroke="#c47855" stroke-width="3.5" stroke-linecap="round"><path d="M32 14v36M14 32h36M19 19l26 26M19 45l26-26M25 16l14 32M16 25l32 14M16 39l32-14M25 48l14-32"/></g></svg>';
    return node;
  }
  function applyPersona(value) {
    if (value?.name) persona = { ...persona, ...value };
    const entry = row?.querySelector("[data-aiyou-claude]");
    if (entry) { entry.replaceChildren(avatar()); const name=document.createElement("span");name.textContent=persona.name;entry.append(name);entry.title=`${persona.name} · Claude Code`;entry.setAttribute("aria-label",`打开 ${persona.name}`); }
    if (panel) {
      const identity=panel.querySelector("[data-claude-identity]");identity.replaceChildren(avatar());
      const name=document.createElement("span");name.dataset.claudeName="";name.textContent=persona.name;identity.append(name);identity.setAttribute("aria-label",`配置 ${persona.name} 的角色`);
      panel.setAttribute("aria-label",`${persona.name} · Claude Code 工作台`);
    }
  }
  function isolateDotHeader() {
    for (const profile of document.querySelectorAll('[class~="group/orbit-profile"]')) {
      const header=profile.closest('[class*="_header_"]');
      if (header && !header.closest(`#${PANEL}`)) { header.setAttribute("data-aiyou-dot-header","");dotHeaders.add(header); }
    }
  }
  function closePersona() {
    if (!panel) return;
    panel.querySelector("[data-claude-persona]").hidden=true;
    panel.querySelector("[data-claude-identity]").setAttribute("aria-expanded","false");
  }
  function openPersona() {
    toggleReferences(false);
    const form=panel.querySelector("[data-claude-persona]");form.hidden=false;logoDraft=persona.logo;
    form.querySelector("[data-persona-name]").value=persona.name;form.querySelector("[data-persona-description]").value=persona.description;
    form.dataset.revision=String(persona.revision);form.querySelector("[data-persona-preview]").replaceChildren(avatar(logoDraft));
    text("[data-claude-persona-error]","");panel.querySelector("[data-claude-identity]").setAttribute("aria-expanded","true");form.querySelector("[data-persona-name]").focus();
  }
  async function readLogo(event) {
    const file=event.target.files?.[0];if(!file)return;
    const form=panel.querySelector("[data-claude-persona]"),save=form.querySelector("[data-claude-persona-save]");
    logoLoading=true;save.disabled=true; text("[data-claude-persona-error]","");
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size>8*1024*1024) throw Error("请选择 8 MB 以内的 PNG、JPG、WebP 或 GIF 图片。");
      const bitmap=await createImageBitmap(file);const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const logo=canvas.toDataURL("image/png");if(logo.length>700000)throw Error("图片过大，请换用更简单的 Logo。");
      if (!form.hidden) {logoDraft=logo;form.querySelector("[data-persona-preview]").replaceChildren(avatar(logoDraft));}
    } catch(error){text("[data-claude-persona-error]",error.message);}finally{logoLoading=false;save.disabled=false;event.target.value="";}
  }
  async function savePersona(event) {
    event.preventDefault();if(logoLoading)return;
    const form=event.target,save=form.querySelector("[data-claude-persona-save]");if(!form.reportValidity())return;
    save.disabled=true;text("[data-claude-persona-error]","");
    try {
      const result=await request("persona-save",{persona:{name:form.querySelector("[data-persona-name]").value.trim(),description:form.querySelector("[data-persona-description]").value.trim(),logo:logoDraft,revision:Number(form.dataset.revision)}});
      if(result?.persona){applyPersona(result.persona);if(data)data.persona=result.persona;closePersona();panel.querySelector("[data-claude-identity]").focus();}
      else text("[data-claude-persona-error]",panel.querySelector("[data-claude-status]").textContent||"保存未确认，请重试。");
    } finally {save.disabled=false;}
  }
  function nativeAvailable(node) {
    for (let parent = node; parent; parent = parent.parentElement) {
      if (parent.hasAttribute("data-aiyou-dot-source")) continue;
      if (parent.matches('[data-app-shell-active-page="false"]') || parent.hidden || getComputedStyle(parent).display === "none") return false;
    }
    return node.isConnected;
  }
  function refresh() {
    if (destroyed) return;
    const current = Array.from(document.querySelectorAll('[data-sidebar-destination="builtin:orbit"]')).find(nativeAvailable);
    if (!current) { row?.remove(); source?.removeAttribute("data-aiyou-dot-source"); source = null; return; }
    if (!row) {
      row = document.createElement("div"); row.id = ENTRY;
      const dot = document.createElement("button"); dot.type = "button"; dot.dataset.aiyouDot = "true"; dot.title = "Dot（裤兜）";
      dot.onclick = () => { close(); if (source?.isConnected) source.click(); };
      const claude = document.createElement("button"); claude.type = "button"; claude.dataset.aiyouClaude = "true";
      claude.setAttribute("aria-controls", PANEL); claude.setAttribute("aria-expanded", "false");
      claude.onclick = open; row.append(dot, claude);
      applyPersona();
    }
    if (source !== current || !row.isConnected || row.parentElement !== current.parentElement) {
      source?.removeAttribute("data-aiyou-dot-source"); source = current; source.setAttribute("data-aiyou-dot-source", "true");
      const dot = row.querySelector("[data-aiyou-dot]"); dot.replaceChildren();
      const icon = source.querySelector("img,svg"); if (icon) dot.append(icon.cloneNode(true));
      const label = document.createElement("span"); label.textContent = "Dot（裤兜）"; dot.append(label);
      source.before(row);
    }
    if (panel && !panel.hidden && !panel.isConnected) mount();
    if (panel && !panel.hidden) isolateDotHeader();
    if (!personaLoaded && !personaLoading && Date.now() >= personaRetryAt && typeof window[BINDING] === "function") {
      personaLoading=true;personaRetryAt=Date.now()+5000;
      void request("persona-get").then(result=>{if(!destroyed&&result?.persona){applyPersona(result.persona);personaLoaded=true;}}).finally(()=>{personaLoading=false;});
    }
  }
  function request(action, fields = {}) {
    return new Promise(resolve => {
      if (typeof window[BINDING] !== "function") { text("[data-claude-status]", "Claude 服务尚未连接；请检查 AIYOUcodex 是否运行。"); resolve(null); return; }
      const requestId = `claude.${Date.now()}.${Math.random().toString(16).slice(2)}`;
      const timer = setTimeout(() => { requests.delete(requestId); text("[data-claude-status]", "请求未收到回执；输入保留，请检查本机连接。"); resolve(null); }, 30000);
      requests.set(requestId, { resolve, timer, action });
      try { window[BINDING](JSON.stringify({ requestId, action, ...fields })); }
      catch { clearTimeout(timer); requests.delete(requestId); resolve(null); text("[data-claude-status]", "本机连接不可用。"); }
    });
  }
  function resolve(response) {
    const pending = requests.get(response?.requestId); if (!pending) return;
    clearTimeout(pending.timer); requests.delete(response.requestId);
    if (!response.ok) text("[data-claude-status]", response.error || "操作未完成。");
    pending.resolve(response.ok ? response.data : null);
  }
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("section"); panel.id = PANEL; panel.hidden = true;
    panel.setAttribute("data-codex-workspace-side-panel", "claude"); panel.setAttribute("aria-label", "Claude Code 工作台");
    panel.innerHTML = `<header><button data-claude-identity aria-haspopup="dialog" aria-expanded="false" title="设置角色名称与 Logo"></button><div class="claude-header-actions"><button data-claude-new title="新建 Claude 会话">＋</button><button data-claude-close aria-label="关闭 Claude Code">×</button></div></header>
      <form data-claude-persona hidden role="dialog" aria-label="Claude 角色设置"><strong>角色设置</strong><div class="claude-persona-logo"><span data-persona-preview></span><button type="button" data-persona-upload>更换 Logo</button><button type="button" data-persona-reset>默认 Logo</button><input type="file" data-persona-file accept="image/png,image/jpeg,image/webp,image/gif"></div><label>名字<input data-persona-name required maxlength="48" autocomplete="off"></label><label>角色说明<textarea data-persona-description maxlength="4000" placeholder="例如：擅长开发与排查问题，回答简洁，优先完成任务。"></textarea></label><small>本机保存，角色说明用于后续 Claude 消息；不会修改 Dot。</small><div data-claude-persona-error role="status"></div><div class="claude-persona-footer"><button type="button" data-persona-cancel>取消</button><button type="submit" data-claude-persona-save>保存</button></div></form>
      <section data-claude-setup><div class="claude-pair"><select data-claude-project aria-label="Codex 项目"></select><select data-claude-session aria-label="Claude 会话"><option value="">新会话</option></select></div>
      <small data-claude-path></small>
      <div data-claude-status role="status">正在连接本机 Claude Code…</div></section>
      <div data-claude-log aria-live="polite"></div><div data-claude-permissions></div>
      <section data-claude-compose>
      <div data-claude-reference-menu hidden role="dialog" aria-label="引用 Skills 与 MCP"><div data-claude-reference-tabs role="tablist"><button data-claude-tab="skills" role="tab" aria-selected="true">Skills · <span data-claude-skill-count>0</span></button><button data-claude-tab="mcps" role="tab" aria-selected="false">MCP · <span data-claude-mcp-count>0</span></button></div><input data-claude-search placeholder="搜索 Codex Skills" aria-label="搜索引用"><div data-claude-skills></div><div data-claude-mcps hidden></div><small>选择后作为引用随消息使用。宿主专用 MCP 不可直接迁移。</small></div>
      <div data-claude-references aria-label="已选择引用"></div><textarea data-claude-prompt placeholder="发送消息…" aria-label="Claude 提示词"></textarea>
      <div class="claude-actions"><button data-claude-add aria-label="添加 Skills 或 MCP 引用" aria-expanded="false">＋</button><small data-claude-model>沿用本机模型与登录</small><button data-claude-stop disabled>停止</button><button data-claude-send aria-label="发送" title="发送">↑</button></div><small data-claude-hint>Enter 发送 · Shift+Enter 换行</small></section>`;
    panel.querySelector("[data-claude-close]").onclick = close;
    panel.querySelector("[data-claude-identity]").onclick=()=>panel.querySelector("[data-claude-persona]").hidden?openPersona():closePersona();
    panel.querySelector("[data-claude-persona]").onsubmit=savePersona;
    panel.querySelector("[data-persona-cancel]").onclick=()=>{closePersona();panel.querySelector("[data-claude-identity]").focus();};
    panel.querySelector("[data-persona-upload]").onclick=()=>panel.querySelector("[data-persona-file]").click();
    panel.querySelector("[data-persona-file]").onchange=readLogo;
    panel.querySelector("[data-persona-reset]").onclick=()=>{logoDraft="";panel.querySelector("[data-persona-preview]").replaceChildren(avatar(""));};
    panel.querySelector("[data-claude-persona]").onkeydown=event=>{
      if(event.key==="Escape"){event.preventDefault();closePersona();panel.querySelector("[data-claude-identity]").focus();}
      if(event.key==="Tab"){const nodes=[...event.currentTarget.querySelectorAll("button,input,textarea")].filter(n=>!n.disabled&&getComputedStyle(n).display!=="none");const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    };
    applyPersona();
    panel.querySelector("[data-claude-new]").onclick = () => { sessionId = ""; skillIds.clear(); mcpIds.clear(); messagesSignature = ""; void reload(); };
    panel.querySelector("[data-claude-project]").onchange = event => { projectId = event.target.value; sessionId = ""; skillIds.clear(); mcpIds.clear(); resourcesSignature = ""; void reload(); };
    panel.querySelector("[data-claude-session]").onchange = event => { sessionId = event.target.value; resourcesSignature = ""; void reload(); };
    panel.querySelector("[data-claude-search]").oninput = renderResources;
    panel.querySelector("[data-claude-add]").onclick = () => toggleReferences();
    for (const tab of panel.querySelectorAll("[data-claude-tab]")) tab.onclick = () => {
      for (const item of panel.querySelectorAll("[data-claude-tab]")) item.setAttribute("aria-selected", String(item === tab));
      panel.querySelector("[data-claude-skills]").hidden = tab.dataset.claudeTab !== "skills";
      panel.querySelector("[data-claude-mcps]").hidden = tab.dataset.claudeTab !== "mcps";
      const search = panel.querySelector("[data-claude-search]"); search.placeholder = tab.dataset.claudeTab === "skills" ? "搜索 Codex Skills" : "搜索 Codex MCP"; search.value = ""; renderResources(); search.focus();
    };
    panel.querySelector("[data-claude-send]").onclick = send;
    panel.querySelector("[data-claude-stop]").onclick = async () => { await request("stop", { sessionId }); await reload(); };
    panel.querySelector("[data-claude-prompt]").onkeydown = event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
      if (event.key === "Escape") { event.preventDefault(); if (!panel.querySelector("[data-claude-reference-menu]").hidden) toggleReferences(false); else close(); }
    };
  }
  function toggleReferences(show) {
    const menu = panel?.querySelector("[data-claude-reference-menu]"); if (!menu) return;
    menu.hidden = show === undefined ? !menu.hidden : !show;
    panel.querySelector("[data-claude-add]").setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) panel.querySelector("[data-claude-search]").focus();
  }
  function outsideReferences(event) {
    if (!panel?.hidden && !event.target.closest("[data-claude-reference-menu],[data-claude-add]")) toggleReferences(false);
    if (!panel?.hidden && !event.target.closest("[data-claude-persona],[data-claude-identity]")) closePersona();
  }
  document.addEventListener("pointerdown", outsideReferences);
  function mount() {
    const mount = api()?.prepareClaudePanel?.();
    const surface = mount?.surface || document.querySelector("main,[role=main]");
    if (!surface) return false;
    // Dot's main surface is a column; its inner workspace is the horizontal
    // pane host. Appending a width-sized flex item to main makes it 1000px tall.
    const workspace = getComputedStyle(surface).flexDirection.startsWith("column")
      ? [...surface.children].find(child => String(child.className).includes("_WorkspaceContent_")) : null;
    const host = workspace || surface;
    host.setAttribute("data-aiyou-claude-host","");panelHosts.add(host);
    if (panel.parentElement !== host) { host.append(panel); if (workspace) surface.scrollTop=0; }
    api()?.initializeClaudePanel?.(panel);
    return true;
  }
  function open() {
    ensurePanel(); if (!mount()) { text("[data-claude-status]", "当前页面无法挂载 Claude 工作台。"); return; }
    panel.hidden = false; row?.querySelector("[data-aiyou-claude]")?.setAttribute("aria-expanded", "true");
    document.body.setAttribute("data-aiyou-claude-active", "");isolateDotHeader();
    void reload(); clearInterval(polling);
    polling = setInterval(() => { if (!document.hidden && !panel.hidden && data?.session?.status === "running") void reload(); }, 1000);
    panel.querySelector("[data-claude-prompt]").focus();
  }
  function close() {
    if (panel) panel.hidden = true; clearInterval(polling); polling = null;
    document.body.removeAttribute("data-aiyou-claude-active");closePersona();
    row?.querySelector("[data-aiyou-claude]")?.setAttribute("aria-expanded", "false");
    api()?.closeClaudePanelLayer?.(panel);
  }
  function updateSelect(selector, entries, value, empty) {
    const select = panel.querySelector(selector);
    const signature = JSON.stringify(entries);
    if (select.dataset.signature !== signature) {
      select.replaceChildren();
      if (empty) select.add(new Option(empty, ""));
      for (const entry of entries) select.add(new Option(entry.name || entry.title, entry.id));
      select.dataset.signature = signature;
    }
    select.value = value;
  }
  function renderResources() {
    if (!panel || !data) return;
    applyPersona(data.persona);
    const locked = data.session?.status === "running";
    const search = panel.querySelector("[data-claude-search]").value.trim().toLowerCase();
    const signature = JSON.stringify([data.projectId, data.skills, data.mcps, data.session?.mcpStatus, [...skillIds], [...mcpIds], locked, search]);
    if (signature === resourcesSignature) return;
    resourcesSignature = signature;
    for (const [selector, items, selected] of [["[data-claude-skills]", data.skills || [], skillIds], ["[data-claude-mcps]", data.mcps || [], mcpIds]]) {
      const target = panel.querySelector(selector); target.replaceChildren();
      for (const item of items.filter(i => `${i.name} ${i.title} ${i.description}`.toLowerCase().includes(search)).slice(0, 150)) {
        const label = document.createElement("label"), checkbox = document.createElement("input"), caption = document.createElement("span");
        checkbox.type = "checkbox"; checkbox.checked = selected.has(item.id); checkbox.disabled = locked || item.available === false;
        checkbox.onchange = () => {
          if (checkbox.checked && selected === skillIds && selected.size >= 20) { checkbox.checked = false; text("[data-claude-status]", "一次最多引用 20 个 Skills。"); return; }
          if (checkbox.checked) selected.add(item.id); else selected.delete(item.id); renderResources();
        };
        const connected = data.session?.mcpStatus?.find(m => m.name === item.id)?.status;
        caption.textContent = `${item.title || item.name}${item.reason ? ` · ${item.reason}` : connected ? ` · ${connected}` : ""}`; label.title = item.description || item.reason || "";
        label.append(checkbox, caption); target.append(label);
      }
      if (!target.children.length) target.textContent = selector.includes("skills") ? "未找到匹配 Skills" : "暂无可迁移的标准 MCP 配置";
    }
    text("[data-claude-skill-count]", String(skillIds.size)); text("[data-claude-mcp-count]", String(mcpIds.size));
    const references = panel.querySelector("[data-claude-references]"); references.replaceChildren();
    for (const [items, selected, kind] of [[data.skills || [], skillIds, "Skill"], [data.mcps || [], mcpIds, "MCP"]]) for (const id of selected) {
      const item = items.find(i => i.id === id); if (!item) continue;
      const chip = document.createElement("button"); chip.dataset.claudeReference = id; chip.title = `${kind} · ${item.description || item.name}`; chip.textContent = `${item.title || item.name} ×`; chip.disabled = locked; chip.setAttribute("aria-label", `移除引用 ${item.title || item.name}`);
      chip.onclick = () => { selected.delete(id); renderResources(); }; references.append(chip);
    }
  }
  function render() {
    if (!panel || !data) return;
    const session = data.session;
    if (session) projectId = session.projectId;
    updateSelect("[data-claude-project]", data.projects || [], projectId, "选择 Codex 项目");
    updateSelect("[data-claude-session]", (data.sessions || []).map(s => ({ ...s, name: `${s.title} · ${s.projectName}` })), sessionId, "新会话");
    panel.querySelector("[data-claude-project]").disabled = Boolean(sessionId);
    text("[data-claude-path]", session?.cwd || data.projects?.find(p => p.id === projectId)?.cwd || "暂无本地项目");
    panel.querySelector("[data-claude-path]").title = panel.querySelector("[data-claude-path]").textContent;
    renderResources();
    const labels = { running: "正在运行…", stopped: "已停止，可继续发送", idle: "已就绪", error: "调用未完成" };
    text("[data-claude-status]", session?.error || (session?.permissions?.length ? "等待你确认工具操作" : session ? labels[session.status] : data.available ? [data.version,"选择项目后开始"].filter(Boolean).join(" · ") : data.reason || "未找到本机 Claude Code，请先安装并登录。"));
    text("[data-claude-model]", session?.model || "沿用本机模型与登录");
    const running = session?.status === "running";
    panel.querySelector("[data-claude-send]").disabled = running || !data.available || !projectId;
    panel.querySelector("[data-claude-stop]").disabled = !running;
    const signature = JSON.stringify([sessionId, session?.messages]);
    if (signature !== messagesSignature) {
      messagesSignature = signature;
      const log = panel.querySelector("[data-claude-log]"), nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      log.replaceChildren();
      for (const message of session?.messages || []) { const article = document.createElement("article"); article.dataset.role = message.role; article.textContent = message.text; log.append(article); }
      if (!log.children.length) { const welcome = document.createElement("article"); welcome.dataset.welcome = "true"; const title = document.createElement("strong"); title.textContent = "今天一起完成什么？"; welcome.append(title, document.createTextNode("选择项目开始对话，通过下方 ＋ 引用 Skills 和 MCP。")); log.append(welcome); }
      if (nearBottom) log.scrollTop = log.scrollHeight;
    }
    const permissions = panel.querySelector("[data-claude-permissions]");
    const pSignature = JSON.stringify(session?.permissions || []);
    if (permissions.dataset.signature !== pSignature) {
      permissions.dataset.signature = pSignature; permissions.replaceChildren();
      for (const item of session?.permissions || []) {
        const card = document.createElement("div"); card.dataset.permission = item.id;
        const title = document.createElement("strong"); title.textContent = `确认工具操作：${item.tool}`;
        const content = document.createElement("pre"); content.textContent = item.input; card.append(title, content);
        for (const [allow, label] of [[true, "允许本次"], [false, "拒绝"]]) {
          const button = document.createElement("button"); button.textContent = label;
          button.onclick = async () => { card.querySelectorAll("button").forEach(b => { b.disabled = true; }); await request("permission", { sessionId, permissionId: item.id, allow }); await reload(); };
          card.append(button);
        }
        permissions.append(card);
      }
    }
  }
  async function reload() {
    if (inFlight || destroyed) return;
    inFlight = true;
    try {
      const result = await request("refresh", { sessionId, projectId });
      if (!result || destroyed) return;
      const changedSession = data?.session?.id !== result.session?.id;
      data = result; projectId ||= data.projectId || "";
      if (changedSession && data.session) { skillIds.clear(); data.session.skillIds?.forEach(id => skillIds.add(id)); mcpIds.clear(); data.session.mcpIds?.forEach(id => mcpIds.add(id)); }
      render();
    } finally { inFlight = false; }
  }
  async function send() {
    const prompt = panel.querySelector("[data-claude-prompt]"), value = prompt.value.trim();
    if (!value || panel.querySelector("[data-claude-send]").disabled) return;
    panel.querySelector("[data-claude-send]").disabled = true;
    const result = await request("send", { sessionId, projectId, prompt: value, skillIds: [...skillIds], mcpIds: [...mcpIds] });
    if (result?.session) { sessionId = result.session.id; data.session = result.session; toggleReferences(false); render(); if (prompt.value.trim() === value) prompt.value = ""; await reload(); }
    else panel.querySelector("[data-claude-send]").disabled = false;
  }
  function onPanel(event) {
    if (event.source === window && event.origin === location.origin && event.data?.type === "codex-workspace-panel:open" && event.data.panel !== "claude") close();
  }
  window.addEventListener("message", onPanel);
  window[KEY] = { refresh, open, close, resolve,
    onBridgeReady() {
      // A plugin reconnect can leave the old native function in the document
      // before its new listener is registered. Retry reads only, never sends.
      for (const [id,pending] of requests) if (["refresh","persona-get"].includes(pending.action)) {clearTimeout(pending.timer);requests.delete(id);pending.resolve(null);}
      personaRetryAt=0;
      setTimeout(()=>{if(!destroyed){refresh();if(panel&&!panel.hidden)void reload();}},0);
    },
    getState: () => ({ projectId, sessionId, data, pending: requests.size }),
    destroy() {
      destroyed = true; close(); source?.removeAttribute("data-aiyou-dot-source"); row?.remove(); panel?.remove(); style.remove();
      for(const header of dotHeaders)header.removeAttribute("data-aiyou-dot-header");dotHeaders.clear();
      for(const host of panelHosts)host.removeAttribute("data-aiyou-claude-host");panelHosts.clear();
      window.removeEventListener("message", onPanel);
      document.removeEventListener("pointerdown", outsideReferences);
      for (const pending of requests.values()) { clearTimeout(pending.timer); pending.resolve(null); } requests.clear();
    } };
  refresh();
})();
