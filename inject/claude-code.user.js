(() => {
  "use strict";
  const KEY = "__aiyouClaudeInjection__", ENTRY = "aiyoucodex-agent-launchers", PANEL = "aiyoucodex-claude-panel";
  const BINDING = "__AIYOUCODEX_CLAUDE_REQUEST__";
  const priorState = window[KEY]?.getState?.();
  const previous = window.__aiyouClaudeRendererHandoff__ || priorState;
  delete window.__aiyouClaudeRendererHandoff__;
  const previousPanel = document.getElementById(PANEL);
  const retainedUI = previous?.ui || { open: previousPanel && !previousPanel.hidden, prompt: previousPanel?.querySelector("[data-claude-prompt]")?.value || "" };
  window[KEY]?.destroy?.();
  let row, source, panel, data, projectId = previous?.projectId || "", sessionId = previous?.sessionId || "", polling, destroyed = false, inFlight = false;
  const requests = new Map(), skillIds = new Set(previous?.skillIds || previous?.data?.session?.skillIds || []), mcpIds = new Set(previous?.mcpIds || previous?.data?.session?.mcpIds || []);
  let resourcesSignature = "", messagesSignature = "";
  const processOpen = new Map(previous?.processOpen || priorState?.processOpen || []);
  let draftMode = previous?.draftMode || "manual", modeBusy = false;
  let slashItems = [], slashIndex = 0, slashSignature = "", slashDismissed = null, localCommandBusy = false;
  let persona = { name: "Claude Code", logo: "", description: "", revision: 0 }, logoDraft = "", logoLoading = false;
  const dotHeaders = new Set();
  const panelHosts = new Set();
  let personaLoaded = false, personaLoading = false, personaRetryAt = 0;
  const style = document.createElement("style");
  style.id = "aiyoucodex-claude-style";
  style.textContent = `
    [data-aiyou-dot-source]{display:none!important}

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
    #${PANEL} .claude-compose-footer{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #${PANEL} [data-claude-mode]{min-height:24px;border:0;border-radius:12px;padding:3px 8px;font-size:10px;color:#595959;background:#80808008;white-space:nowrap}
    #${PANEL} [data-claude-mode][data-auto=true]{color:#168675;background:#20b7a512}
    #${PANEL} [data-claude-mode-menu]{position:absolute;right:12px;bottom:40px;z-index:8;width:220px;padding:6px;background:Canvas;border:1px solid #80808025;border-radius:12px;box-shadow:0 6px 24px #00000012}
    #${PANEL} [data-claude-mode-menu][hidden]{display:none!important}
    #${PANEL} [data-claude-mode-menu] button{display:block;width:100%;text-align:left;border:0;background:transparent;color:#595959;font-size:12px}
    #${PANEL} [data-claude-mode-menu] button:hover{background:#8080800c}
    #${PANEL} .claude-choices{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;white-space:normal}
    #${PANEL} .claude-choices button{border-radius:14px;padding:5px 10px;font-size:12px;color:#595959;background:Canvas;border-color:#80808030;max-width:100%;text-align:left}
    #${PANEL} [data-question]{display:grid;gap:7px;padding:8px 0;border-bottom:1px solid #80808015}
    #${PANEL} [data-question] label{align-items:flex-start;padding:7px;border:1px solid #80808020;border-radius:8px;font-size:12px;cursor:pointer}
    #${PANEL} [data-question] label:has(input:checked){border-color:#20b7a5;background:#20b7a508}
    #${PANEL} [data-question] label input{margin-top:3px;accent-color:#20b7a5}
    #${PANEL} [data-question] small{display:block;opacity:.7;margin-top:3px}
    #${PANEL} [data-question-custom]{width:100%;font-size:12px}
    #${PANEL} [data-question-error]{color:#be4545;font-size:11px;min-height:0}
    #${PANEL} [data-claude-command-menu]{position:absolute;left:0;right:0;bottom:calc(100% + 8px);max-height:min(340px,45vh);overflow:auto;padding:6px;background:Canvas;border:1px solid #80808025;border-radius:16px;box-shadow:0 8px 28px #00000012;z-index:9;overscroll-behavior:contain}
    #${PANEL} [data-claude-command-menu][hidden],#${PANEL} [data-claude-command-hint][hidden]{display:none!important}
    #${PANEL} [data-claude-command-menu] button{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;border:0;border-radius:9px;background:transparent;padding:8px 10px;min-height:44px;color:#595959;font-size:12px}
    #${PANEL} [data-claude-command-menu] button[aria-selected=true]{background:#20b7a510}
    #${PANEL} .claude-command-title{display:flex;align-items:center;gap:6px;width:100%}
    #${PANEL} .claude-command-title strong{font-weight:550;font-size:12px}
    #${PANEL} .claude-command-title span{margin-left:auto;font-size:10px;color:#888;white-space:nowrap}
    #${PANEL} [data-claude-command-menu] small{font-size:11px;opacity:.75;white-space:normal;line-height:1.5}
    #${PANEL} [data-claude-command-menu] [data-command-footer]{padding:6px 10px;border-top:1px solid #80808015;color:#999;font-size:10px}
    #${PANEL} [data-claude-command-hint]{font-size:11px;line-height:1.5;color:#595959;white-space:pre-wrap;opacity:.8;padding:3px 5px}
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
    #${PANEL} [data-claude-process]{margin:6px 0 12px;max-width:100%;color:var(--aiyou-muted,var(--color-text-secondary,#777));font-size:12px}
    #${PANEL} [data-claude-process]>summary{font-weight:400;padding:5px 0;list-style:none;display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none}
    #${PANEL} [data-claude-process]>summary::-webkit-details-marker{display:none}
    #${PANEL} [data-claude-process]>summary::after{content:'⌄';font-size:14px;transition:transform .15s}
    #${PANEL} [data-claude-process][open]>summary::after{transform:rotate(180deg)}
    #${PANEL} [data-claude-process]>summary svg{width:15px;height:15px;flex:none}
    #${PANEL} [data-claude-process-content]{margin:4px 0 8px 7px;padding:4px 0 4px 14px;border-left:1px solid var(--aiyou-border,#80808030);display:grid;gap:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6}
    #${PANEL} [data-claude-process]:not([open])>[data-claude-process-content]{display:none!important}
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
      <div data-claude-command-menu hidden role="listbox" id="aiyou-claude-slash-menu" aria-label="Claude 快捷指令"></div><small data-claude-command-hint hidden role="status"></small>
      <div data-claude-reference-menu hidden role="dialog" aria-label="引用 Skills 与 MCP"><div data-claude-reference-tabs role="tablist"><button data-claude-tab="skills" role="tab" aria-selected="true">Skills · <span data-claude-skill-count>0</span></button><button data-claude-tab="mcps" role="tab" aria-selected="false">MCP · <span data-claude-mcp-count>0</span></button></div><input data-claude-search placeholder="搜索 Codex Skills" aria-label="搜索引用"><div data-claude-skills></div><div data-claude-mcps hidden></div><small>选择后作为引用随消息使用。宿主专用 MCP 不可直接迁移。</small></div>
      <div data-claude-references aria-label="已选择引用"></div><textarea data-claude-prompt placeholder="发送消息，或输入 / 使用快捷指令…" aria-label="Claude 提示词" aria-autocomplete="list" aria-controls="aiyou-claude-slash-menu" aria-expanded="false"></textarea>
      <div class="claude-actions"><button data-claude-add aria-label="添加 Skills 或 MCP 引用" aria-expanded="false">＋</button><small data-claude-model>沿用本机模型与登录</small><button data-claude-stop disabled>停止</button><button data-claude-send aria-label="发送" title="发送">↑</button></div>
      <div class="claude-compose-footer"><small data-claude-hint>Enter 发送 · Shift+Enter 换行</small><button data-claude-mode aria-haspopup="menu" aria-expanded="false">手动 ▾</button></div>
      <div data-claude-mode-menu hidden role="menu" aria-label="Claude 权限模式"><button data-set-mode="manual" role="menuitem">手动 · 按次确认</button><button data-set-mode="auto" role="menuitem">Auto · 始终允许</button><small>自动允许工具操作；选择题仍需你作答。仅当前 Claude 会话生效。</small></div></section>`;
    panel.querySelector("[data-claude-close]").onclick = close;
    panel.querySelector("[data-claude-prompt]").value = retainedUI.prompt;
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
    panel.querySelector("[data-claude-new]").onclick = newSession;
    panel.querySelector("[data-claude-project]").onchange = event => { projectId = event.target.value; sessionId = ""; draftMode = "manual"; skillIds.clear(); mcpIds.clear(); resourcesSignature = ""; void reload(); };
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
    panel.querySelector("[data-claude-mode]").onclick = () => toggleMode();
    for (const button of panel.querySelectorAll("[data-set-mode]")) button.onclick = () => setMode(button.dataset.setMode);
    panel.querySelector("[data-claude-mode-menu]").onkeydown = event => { if (event.key === "Escape") { event.preventDefault(); toggleMode(false); panel.querySelector("[data-claude-mode]").focus(); } };
    panel.querySelector("[data-claude-stop]").onclick = async () => { await request("stop", { sessionId }); await reload(); };
    panel.querySelector("[data-claude-prompt]").onkeydown = event => {
      if (event.isComposing) return;
      const menu = panel.querySelector("[data-claude-command-menu]");
      if (!menu.hidden && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key) && !event.shiftKey) {
        event.preventDefault();
        if (event.key === "Escape") hideCommands();
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") { slashIndex = (slashIndex + (event.key === "ArrowDown" ? 1 : -1) + slashItems.length) % (slashItems.length || 1); highlightCommand(); }
        else if (slashItems[slashIndex]) chooseCommand(slashItems[slashIndex]);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
      if (event.key === "Escape") { event.preventDefault(); if (!panel.querySelector("[data-claude-mode-menu]").hidden) toggleMode(false); else if (!panel.querySelector("[data-claude-reference-menu]").hidden) toggleReferences(false); else close(); }
    };
    const prompt = panel.querySelector("[data-claude-prompt]");
    prompt.oninput = () => { slashDismissed = null; panel.querySelector("[data-claude-command-hint]").hidden = true; renderCommands(); };
    prompt.onfocus = renderCommands;
    prompt.onclick = renderCommands;
    prompt.onkeyup = event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) renderCommands(); };
  }
  function commandHint(value) { const hint = panel.querySelector("[data-claude-command-hint]"); hint.textContent = value; hint.hidden = !value; }
  function hideCommands() {
    if (!panel) return;
    panel.querySelector("[data-claude-command-menu]").hidden = true;
    const prompt = panel.querySelector("[data-claude-prompt]"); prompt.setAttribute("aria-expanded", "false"); prompt.removeAttribute("aria-activedescendant"); slashDismissed = prompt.value;
  }
  function highlightCommand() {
    const buttons = [...panel.querySelectorAll("[data-claude-command]")];
    buttons.forEach((button, i) => button.setAttribute("aria-selected", String(i === slashIndex)));
    const selected = buttons[slashIndex];
    if (selected) { panel.querySelector("[data-claude-prompt]").setAttribute("aria-activedescendant", selected.id); selected.scrollIntoView({ block: "nearest" }); }
  }
  function renderCommands() {
    if (!panel || !data) return;
    const prompt = panel.querySelector("[data-claude-prompt]"), menu = panel.querySelector("[data-claude-command-menu]");
    const match = prompt.value.match(/^\s*\/([\p{L}\p{N}._:@-]*)$/u);
    if (data.commandVersion !== 1 || !match || document.activeElement !== prompt || slashDismissed === prompt.value || prompt.selectionStart !== prompt.selectionEnd) { menu.hidden = true; prompt.setAttribute("aria-expanded", "false"); prompt.removeAttribute("aria-activedescendant"); return; }
    const query = match[1].toLowerCase();
    const all = data.commands || [];
    slashItems = all.filter(c => c.name.toLowerCase().includes(query) || (c.description || "").toLowerCase().includes(query));
    slashItems.sort((a,b) => Number(b.name.startsWith(query)) - Number(a.name.startsWith(query)));
    const signature = JSON.stringify([prompt.value, slashItems]);
    if (signature !== slashSignature) {
      slashSignature = signature; slashIndex = 0; menu.replaceChildren();
      for (const [index, item] of slashItems.entries()) {
        const button = document.createElement("button"); button.type = "button"; button.tabIndex = -1; button.dataset.claudeCommand = item.name; button.id = `aiyou-claude-command-${index}`; button.setAttribute("role", "option");
        const title = document.createElement("div"); title.className = "claude-command-title";
        const name = document.createElement("strong"); name.textContent = `/${item.name}`;
        const args = document.createElement("small"); args.textContent = item.argumentHint || "";
        const source = document.createElement("span"); source.textContent = item.source || (item.kind === "panel" ? "面板操作" : "Claude Code"); title.append(name,args,source);
        const description = document.createElement("small"); description.textContent = item.description; button.append(title,description);
        button.onpointerdown = event => event.preventDefault(); button.onclick = () => chooseCommand(item); menu.append(button);
      }
      if (!slashItems.length) { const empty = document.createElement("div"); empty.textContent = "未找到匹配指令；可输入 /help 查看说明。"; empty.style.padding = "12px"; menu.append(empty); }
      const footer = document.createElement("div"); footer.dataset.commandFooter = ""; footer.textContent = "↑ ↓ 选择 · Enter / Tab 填入 · Esc 关闭 · 再次 Enter 执行"; menu.append(footer);
    }
    menu.hidden = false; prompt.setAttribute("aria-expanded", "true"); highlightCommand();
  }
  function chooseCommand(item) {
    const prompt = panel.querySelector("[data-claude-prompt]"); prompt.value = `/${item.name} `; prompt.setSelectionRange(prompt.value.length, prompt.value.length); prompt.focus(); hideCommands(); toggleReferences(false); toggleMode(false);
    commandHint(`/${item.name}${item.argumentHint ? " " + item.argumentHint : ""} · ${item.description}\n${item.kind === "panel" ? "按 Enter 在面板内操作，不发送模型。" : item.verified ? "补充参数后按 Enter，交由 Claude Code 执行。" : "按 Enter 后先核对本机支持情况，不支持时不会发给模型。"}`);
  }
  async function newSession() { sessionId = ""; draftMode = "manual"; skillIds.clear(); mcpIds.clear(); messagesSignature = ""; hideCommands(); await reload(); }
  async function panelCommand(value) {
    const match = value.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/u);
    const item = data?.commands?.find(c => c.name === match?.[1] && c.kind === "panel");
    if (!item) return false;
    const argument = (match[2] || "").trim(), prompt = panel.querySelector("[data-claude-prompt]");
    hideCommands();
    if (["help", "clear", "status"].includes(item.name) && argument) { commandHint(`/${item.name} 不需要参数。`); return true; }
    if (item.name === "permissions" && argument && !["auto", "manual"].includes(argument)) { commandHint("用法：/permissions [auto|manual]"); return true; }
    if (item.name === "permissions" && argument && !await setMode(argument)) return true;
    if (prompt.value.trim() === value) prompt.value = "";
    if (item.name === "help") commandHint("输入 / 搜索快捷指令；↑ ↓ 选择，Enter / Tab 填入，再次 Enter 执行。\n面板指令不请求模型；Claude Code 原生命令发送前校验，项目 Skills 与 MCP 指令随会话自动更新。");
    if (item.name === "clear") { await newSession(); commandHint("已新建空白对话；原会话及运行中任务保留，可用 /resume 返回。"); }
    if (item.name === "permissions") { if (!argument) { toggleMode(true); panel.querySelector('[data-set-mode="manual"]').focus(); } else commandHint(`已切换为 ${argument === "auto" ? "Auto · 始终允许" : "手动确认"}。`); }
    if (["skills", "mcp"].includes(item.name)) {
      toggleReferences(true); const tab = item.name === "skills" ? "skills" : "mcps"; panel.querySelector(`[data-claude-tab="${tab}"]`).click(); panel.querySelector("[data-claude-search]").value = argument; renderResources();
      commandHint("在引用列表中选择所需项；它们随下一条消息使用，不会自动发送。");
    }
    if (item.name === "resume") {
      const matches = (data.sessions || []).filter(s => s.id === argument || s.title === argument);
      if (argument && matches.length === 1) { sessionId = matches[0].id; resourcesSignature = ""; await reload(); }
      else { commandHint(argument ? "未找到唯一会话，请从上方列表选择。" : "请从上方 Claude 会话列表选择要继续的对话。"); const select = panel.querySelector("[data-claude-session]"); select.focus(); try { select.showPicker?.(); } catch {} }
    }
    if (item.name === "status") { const s = data.session; commandHint(`项目：${s?.projectName || data.projects?.find(p => p.id === projectId)?.name || "未选择"}\n模型：${s?.model || "沿用本机 Claude 配置"} · 权限：${s?.permissionMode || draftMode}\n状态：${s?.status || "新会话"} · Skills ${skillIds.size} / MCP ${mcpIds.size}`); }
    return true;
  }
  function toggleReferences(show) {
    const menu = panel?.querySelector("[data-claude-reference-menu]"); if (!menu) return;
    menu.hidden = show === undefined ? !menu.hidden : !show;
    if (!menu.hidden) { hideCommands(); toggleMode(false); }
    panel.querySelector("[data-claude-add]").setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) panel.querySelector("[data-claude-search]").focus();
  }
  function outsideReferences(event) {
    if (!panel?.hidden && !event.target.closest("[data-claude-reference-menu],[data-claude-add]")) toggleReferences(false);
    if (!panel?.hidden && !event.target.closest("[data-claude-persona],[data-claude-identity]")) closePersona();
    if (!panel?.hidden && !event.target.closest("[data-claude-mode-menu],[data-claude-mode]")) toggleMode(false);
    if (!panel?.hidden && !event.target.closest("[data-claude-command-menu],[data-claude-prompt]")) hideCommands();
  }
  function toggleMode(show) {
    const menu = panel?.querySelector("[data-claude-mode-menu]"); if (!menu) return;
    menu.hidden = show === undefined ? !menu.hidden : !show;
    if (!menu.hidden) { hideCommands(); toggleReferences(false); }
    panel.querySelector("[data-claude-mode]").setAttribute("aria-expanded", String(!menu.hidden));
  }
  async function setMode(mode) {
    if (modeBusy || data?.interactionVersion !== 1) return false;
    toggleMode(false);
    if (!sessionId) { draftMode = mode; render(); return true; }
    const targetSession = sessionId;
    modeBusy = true; render();
    try {
      const result = await request("permission-mode", { sessionId: targetSession, mode });
      if (result?.session && sessionId === targetSession) { data.session = result.session; render(); await reload(); }
      return Boolean(result?.session);
    } finally { modeBusy = false; render(); }
  }
  function questionCard(item, targetSession) {
    const form = document.createElement("form"); form.dataset.permission = item.id;
    const title = document.createElement("strong"); title.textContent = "请选择后继续"; form.append(title);
    for (const q of item.questions) {
      const group = document.createElement("section"); group.dataset.question = q.id;
      const caption = document.createElement("div"); caption.textContent = `${q.header ? q.header + " · " : ""}${q.question}${q.multiSelect ? "（可多选）" : ""}`; group.append(caption);
      for (const option of q.options) {
        const label = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span");
        input.type = q.multiSelect ? "checkbox" : "radio"; input.name = `question-${item.id}-${q.id}`; input.value = option.id;
        text.textContent = option.label;
        if (option.description) { const description = document.createElement("small"); description.textContent = option.description; text.append(description); }
        input.onchange = () => { if (!q.multiSelect) group.querySelector("[data-question-custom]").value = ""; };
        label.append(input, text); group.append(label);
      }
      const custom = document.createElement("input"); custom.dataset.questionCustom = ""; custom.placeholder = "其他：输入你的答案"; custom.maxLength = 4000; custom.setAttribute("aria-label", `${q.header || q.question}：自填答案`);
      custom.oninput = () => { if (!q.multiSelect && custom.value.trim()) group.querySelectorAll("input[type=radio]").forEach(e => { e.checked = false; }); };
      group.append(custom); form.append(group);
    }
    const error = document.createElement("div"); error.dataset.questionError = ""; error.setAttribute("role", "status");
    const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "确认选择";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消";
    cancel.onclick = async () => { cancel.disabled = submit.disabled = true; const result = await request("permission", { sessionId: targetSession, permissionId: item.id, allow: false }); if (result) await reload(); else cancel.disabled = submit.disabled = false; };
    form.append(error, submit, cancel);
    form.onsubmit = async event => {
      event.preventDefault(); if (submit.disabled || sessionId !== targetSession) return;
      const answers = item.questions.map(q => { const g = [...form.querySelectorAll("[data-question]")].find(e => e.dataset.question === q.id); return { selected: [...g.querySelectorAll("input:checked")].map(e => e.value), custom: g.querySelector("[data-question-custom]").value.trim() }; });
      if (answers.some((a, i) => !a.selected.length && !a.custom || !item.questions[i].multiSelect && a.selected.length + Boolean(a.custom) !== 1)) { error.textContent = "请回答全部问题；单选题只选一项或填写其他答案。"; return; }
      submit.disabled = cancel.disabled = true; error.textContent = "正在提交…";
      const result = await request("question-answer", { sessionId: targetSession, permissionId: item.id, answers });
      if (result) await reload(); else { submit.disabled = cancel.disabled = false; error.textContent = "答案未确认送达，请检查连接或重新载入。"; }
    };
    return form;
  }
  async function answerChoice(choices, value, container, targetSession) {
    if (sessionId !== targetSession || container.dataset.sending) return;
    container.dataset.sending = "true"; container.querySelectorAll("button").forEach(b => { b.disabled = true; });
    const result = await request("choice", { sessionId: targetSession, messageId: choices.messageId, value });
    if (result?.session && sessionId === targetSession) { data.session = result.session; render(); await reload(); }
    else { delete container.dataset.sending; container.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
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
    text("[data-claude-status]", session?.error || (session?.permissions?.length ? session.permissions.some(p => p.kind === "question") ? "等待你选择或填写答案" : "等待你确认工具操作" : session ? labels[session.status] : data.available ? [data.version,"选择项目后开始"].filter(Boolean).join(" · ") : data.reason || "未找到本机 Claude Code，请先安装并登录。"));
    text("[data-claude-model]", session?.model || "沿用本机模型与登录");
    const running = session?.status === "running";
    const mode = session?.permissionMode || draftMode;
    const modeButton = panel.querySelector("[data-claude-mode]"); modeButton.textContent = `${mode === "auto" ? "Auto · 始终允许" : "手动"} ▾`;
    modeButton.dataset.auto = String(mode === "auto"); modeButton.disabled = modeBusy || data.interactionVersion !== 1;
    modeButton.title = data.interactionVersion === 1 ? "切换 Claude 工具权限模式" : "服务需更新后才能切换权限模式";
    panel.querySelectorAll("[data-set-mode]").forEach(b => { b.disabled = modeBusy; });
    panel.querySelector("[data-claude-send]").disabled = running || !data.available || !projectId;
    panel.querySelector("[data-claude-stop]").disabled = !running;
    renderCommands();
    const signature = JSON.stringify([sessionId, session?.messages, session?.replyChoices, session?.status]);
    if (signature !== messagesSignature) {
      messagesSignature = signature;
      const log = panel.querySelector("[data-claude-log]"), nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      log.replaceChildren();
      const messages = session?.messages || [];
      let process = [], processIndex = 0;
      function flushProcess() {
        if (!process.length) return;
        const items = process, key = `${sessionId}:${items[0].id || processIndex++}`;
        const details = document.createElement("details"), summary = document.createElement("summary"), content = document.createElement("div"), caption = document.createElement("span");
        details.dataset.claudeProcess = key; content.dataset.claudeProcessContent = "";
        const tools = items.filter(m => m.role === "tool").length;
        const pending = running && messages.at(-1) === items.at(-1);
        caption.textContent = `${pending ? "正在处理" : "处理过程"} · ${tools ? `${tools} 次工具调用` : `${items.length} 项过程记录`}`;
        summary.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="3" stroke="currentColor" stroke-width="1.4"/><path d="m6 7 3 3-3 3m5 0h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        summary.append(caption);
        for (const item of items) { const line = document.createElement("div"); line.dataset.processRole = item.role; line.textContent = item.text; content.append(line); }
        details.open = processOpen.get(key) === true;
        details.addEventListener("toggle", () => { if (details.isConnected) { processOpen.set(key, details.open); if (processOpen.size > 200) processOpen.delete(processOpen.keys().next().value); } });
        details.append(summary, content); log.append(details); process = [];
      }
      for (const [index, message] of messages.entries()) {
        // Older sessions lacked progress roles. A text immediately followed by
        // a tool marker is pre-call narration, not the final answer. Never hide
        // an answer with clickable business choices or an explicit error.
        const isProcess = ["tool", "progress", "thinking"].includes(message.role) || (message.role === "assistant" && messages[index + 1]?.role === "tool");
        if (isProcess && (!session.replyChoices || session.replyChoices.messageId !== message.id)) { process.push(message); continue; }
        flushProcess();
        const article = document.createElement("article"); article.dataset.role = message.role; article.textContent = message.text;
        const choices = session.replyChoices;
        if (choices && choices.messageId === message.id) {
          const buttons = document.createElement("div"); buttons.className = "claude-choices"; const targetSession = sessionId;
          for (const option of choices.options) { const button = document.createElement("button"); button.dataset.claudeChoice = option.value; button.textContent = `${option.value}. ${option.label}`; button.onclick = () => answerChoice(choices, option.value, buttons, targetSession); buttons.append(button); }
          article.append(buttons);
        }
        log.append(article);
      }
      flushProcess();
      if (!log.children.length) { const welcome = document.createElement("article"); welcome.dataset.welcome = "true"; const title = document.createElement("strong"); title.textContent = "今天一起完成什么？"; welcome.append(title, document.createTextNode("选择项目开始对话，通过下方 ＋ 引用 Skills 和 MCP。")); log.append(welcome); }
      if (nearBottom) log.scrollTop = log.scrollHeight;
    }
    const permissions = panel.querySelector("[data-claude-permissions]");
    const pSignature = JSON.stringify(session?.permissions || []);
    if (permissions.dataset.signature !== pSignature) {
      permissions.dataset.signature = pSignature; permissions.replaceChildren();
      for (const item of session?.permissions || []) {
        const targetSession = sessionId;
        if (item.kind === "question" && item.questions?.length) { permissions.append(questionCard(item, targetSession)); continue; }
        const card = document.createElement("div"); card.dataset.permission = item.id;
        const title = document.createElement("strong"); title.textContent = `确认工具操作：${item.tool}`;
        const content = document.createElement("pre"); content.textContent = item.input; card.append(title, content);
        for (const [allow, label] of [[true, "允许本次"], [false, "拒绝"]]) {
          const button = document.createElement("button"); button.textContent = label;
          button.onclick = async () => { card.querySelectorAll("button").forEach(b => { b.disabled = true; }); const result = await request("permission", { sessionId: targetSession, permissionId: item.id, allow }); if (result) await reload(); else card.querySelectorAll("button").forEach(b => { b.disabled = false; }); };
          card.append(button);
        }
        if (item.autoEligible && data.interactionVersion === 1) { const auto = document.createElement("button"); auto.textContent = "始终允许（Auto）"; auto.onclick = () => { if (sessionId === targetSession) void setMode("auto"); }; card.append(auto); }
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
    if (!value || localCommandBusy) return;
    localCommandBusy = true;
    try { if (await panelCommand(value)) return; } finally { localCommandBusy = false; }
    if (panel.querySelector("[data-claude-send]").disabled) return;
    hideCommands();
    panel.querySelector("[data-claude-send]").disabled = true;
    const result = await request("send", { sessionId, projectId, prompt: value, skillIds: [...skillIds], mcpIds: [...mcpIds], ...(!sessionId ? { permissionMode: draftMode } : {}) });
    if (result?.session) { sessionId = result.session.id; data.session = result.session; toggleReferences(false); render(); if (prompt.value.trim() === value) prompt.value = ""; panel.querySelector("[data-claude-command-hint]").hidden = true; await reload(); }
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
    getState: () => ({ projectId, sessionId, data, pending: requests.size, draftMode, processOpen: [...processOpen], skillIds: [...skillIds], mcpIds: [...mcpIds] }),
    destroy() {
      destroyed = true; close(); source?.removeAttribute("data-aiyou-dot-source"); row?.remove(); panel?.remove(); style.remove();
      for(const header of dotHeaders)header.removeAttribute("data-aiyou-dot-header");dotHeaders.clear();
      for(const host of panelHosts)host.removeAttribute("data-aiyou-claude-host");panelHosts.clear();
      window.removeEventListener("message", onPanel);
      document.removeEventListener("pointerdown", outsideReferences);
      for (const pending of requests.values()) { clearTimeout(pending.timer); pending.resolve(null); } requests.clear();
    } };
  refresh();
  if (retainedUI.open) open();
})();
