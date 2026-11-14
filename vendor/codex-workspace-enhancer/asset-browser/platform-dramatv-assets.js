import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";

const enabledTools = ["list_projects", "list_canvases", "search_nodes", "get_node_detail"];
const codex = [process.env.AIYOU_CODEX_CLI, "/opt/homebrew/bin/codex", "/usr/local/bin/codex"].filter(Boolean).find(existsSync) || "codex";
const configPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");

export async function withDramaMcp(work) {
  if (!existsSync(configPath)) throw new Error("未找到 Codex 的 DramaTV MCP 配置。");
  const environment = { ...process.env, PATH: [path.dirname(process.execPath),process.env.PATH].filter(Boolean).join(path.delimiter) };
  const child = spawn(codex, ["app-server", "--listen", "stdio://", "-c", 'mcp_servers.dramatv-canvas.enabled_tools=' + JSON.stringify(enabledTools)], { env:environment, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  let sequence = 0, closed = false;
  const pending = new Map();
  const fail = error => { closed = true; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.on("error", () => fail(new Error("无法启动 Codex MCP 连接，请检查 Codex CLI。")));
  child.on("exit", () => fail(new Error("Codex MCP 连接已退出。")));
  child.stdin.on("error", () => fail(new Error("Codex MCP 连接已关闭。")));
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    let packet; try { packet = JSON.parse(line); } catch { return; }
    const item = pending.get(packet.id);
    if (!item) {
      if (packet.id !== undefined && packet.method) {
        child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:packet.id, error:{ code:-32601, message:"Interactive requests are unavailable in the Asset Library; sign in in Codex first." } }) + "\n");
      }
      return;
    }
    if (packet.method) return;
    pending.delete(packet.id); clearTimeout(item.timer);
    if (packet.error) item.reject(new Error(item.method === "mcpServer/tool/call" ? "DramaTV MCP 未能读取数据，请检查现有连接与登录状态。" : "Codex CLI 未能开启 MCP 会话。"));
    else item.resolve(packet.result);
  });
  function rpc(method, params) {
    if (closed) return Promise.reject(new Error("Codex MCP 连接不可用。"));
    return new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("DramaTV MCP 读取超时。")); }, method === "mcpServer/tool/call" ? 65000 : 20000);
      pending.set(id,{resolve,reject,timer,method});
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
    });
  }
  try {
    await rpc("initialize", { clientInfo:{ name:"aiyoucodex-asset-library",version:"1.0.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"initialized"})+"\n");
    const thread = await rpc("thread/start", { ephemeral:true, cwd:os.homedir(), approvalPolicy:"never", sandbox:"read-only" });
    const threadId = thread?.thread?.id;
    if (!threadId) throw new Error("Codex CLI 未返回 MCP 会话。");
    return await work(async (tool,args) => {
      if (!enabledTools.includes(tool)) throw new Error("不是可用的 DramaTV 只读工具。");
      const result = await rpc("mcpServer/tool/call",{threadId,server:"dramatv-canvas",tool,arguments:args});
      let payload = result?.structuredContent;
      if (!payload) for (const part of result?.content || []) {
        if (part.type === "text") { try { payload = JSON.parse(part.text); break; } catch {} }
      }
      if (result?.isError || payload?.ok !== true || !payload.data) throw new Error("DramaTV MCP 未返回可读取的数据，请检查登录和项目权限。");
      return payload.data;
    });
  } finally {
    fail(new Error("MCP 会话已关闭。"));
    lines.close(); child.stdin.end(); child.kill();
  }
}

async function pages(call, tool, args, cap = 100) {
  const result = [];
  for (let page=1;page<=cap;page++) {
    const response = await call(tool,{...args,page,size:50});
    if (!Array.isArray(response.items)) throw new Error("DramaTV MCP 返回的列表格式无法识别。");
    result.push(...response.items);
    if (response.hasMore === false || response.items.length === 0 ||
      (response.hasMore !== true && (Number.isFinite(response.total) ? result.length >= response.total : response.items.length < 50))) return result;
  }
  throw new Error("DramaTV MCP 返回的项目内容超过本次分页上限，未标记为完整同步。");
}

export async function listDramaProjects() {
  return withDramaMcp(async call => {
    const results = await Promise.allSettled(["personal","team"].map(category => pages(call,"list_projects",{category})));
    const rows = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (results.every(result => result.status === "rejected")) throw results[0].reason;
    return { projects:[...new Map(rows.map(row=>[String(row.id),{id:String(row.id),name:row.name}])).values()],
      ...(results.some(r=>r.status==="rejected") ? { notice:"有一个项目范围不可读取，仅显示已返回的项目。" } : {}) };
  });
}

const strings = values => Array.isArray(values) ? values.filter(x=>typeof x==="string").slice(0,50) : [];
function mediaKind(node) {
  const key = String(node.type || "").toLowerCase();
  if (key.includes("image")) return "image"; if (key.includes("video")) return "video"; if (key.includes("audio")) return "audio";
  return "";
}

export async function listDramaAssets(id) {
  const projectId = Number(id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("DramaTV 项目无效。");
  return withDramaMcp(async call => {
    const canvases=await pages(call,"list_canvases",{projectId,includeEpisodes:true});
    const rows=[];
    for (const canvas of canvases) {
      const nodes=await pages(call,"search_nodes",{projectId,canvasId:canvas.id,hasMedia:true});
      for(let i=0;i<nodes.length;i+=10){
        const batch=nodes.slice(i,i+10);
        const details=await call("get_node_detail",{projectId,canvasId:canvas.id,nodeIds:batch.map(node=>node.id),maxTextChars:24000});
        if (!Array.isArray(details.items)) throw new Error("DramaTV MCP 未返回素材详情。");
        const byId=new Map(details.items.map(node=>[node.id,node]));
        for (const brief of batch) {
          const node=byId.get(brief.id)||brief, data=node.data||{}, kind=mediaKind(node);
          if(!kind) continue;
          const primary=node.mediaUrl||brief.mediaUrl;
          const variants=[primary,...["imageItems","videoItems","audioItems"].flatMap(key=>Array.isArray(data[key]) ? data[key].map(item=>item?.url) : [])].filter(x=>typeof x==="string"&&x);
          for(const [index,url] of [...new Set(variants)].entries()){
            const match=primary&&new URL(url).pathname===new URL(primary).pathname;
            const onlyOne=new Set(variants).size===1;
            rows.push({ id: `${canvas.id}:${node.id}:${new URL(url).pathname}`, name:index ? `${node.title||brief.title||node.id} · ${index+1}` : node.title||brief.title||node.id, kind,url,
              prompt:match||onlyOne ? data.prompt : undefined,negativePrompt:match||onlyOne ? data.negativePrompt : undefined,model:match||onlyOne ? data.model||data.modelName : undefined,
              references:strings(node.inputs), downstream:strings(node.outputs),folder:canvas.name,sourceNodeId:node.id,canvasId:String(canvas.id),status:node.status,
              settings:Object.fromEntries(Object.entries({aspectRatio:data.aspectRatio,resolution:data.resolution,duration:data.duration,seed:data.seed,inputMode:data.inputMode,episodeId:canvas.episodeId}).filter(([,v])=>["number","boolean","string"].includes(typeof v))) });
          }
        }
      }
    }
    return rows;
  });
}
