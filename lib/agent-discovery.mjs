import os from 'node:os';
import path from 'node:path';
import {readdir, stat, lstat, realpath, access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);

// Content locations are reference data from Luzi 0.2.1's extracted catalog.
// Installation evidence is collected independently; content alone is never an installation proof.
export const AGENT_CATALOG = [
 {id:'codex',name:'Codex',roots:['.codex'],skills:['skills'],shared:true,instruction:'AGENTS.md',memory:'memories/MEMORY.md',cli:['codex'],apps:['codex','chatgpt'],bundleIds:['com.openai.codex'],mark:'Cx'},
 {id:'claude-code',name:'Claude Code',roots:['.claude'],skills:['skills'],instruction:'CLAUDE.md',cli:['claude'],apps:['claude'],mark:'Cl'},
 {id:'hermes',name:'Hermes',roots:['.hermes','AppData/Local/hermes'],skills:['skills'],instruction:'SOUL.md',memory:'memories/MEMORY.md',cli:['hermes'],apps:['hermes'],mark:'He'},
 {id:'doubao-work',name:'豆包工作',roots:['Library/Application Support/DoubaoWork/Default/.doubaowork','AppData/Local/DoubaoWork/User Data/Default/.doubaowork'],skills:['agent_mode/workspace/.user_skills'],shared:true,cli:[],apps:['doubaowork','豆包工作'],mark:'豆'},
 {id:'kimi-work',name:'Kimi Work',roots:['Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/kimi-code/home'],presenceRoots:['Library/Application Support/kimi-desktop/daimon-share/daimon'],skills:['skills'],shared:true,instruction:'AGENTS.md',cli:[],apps:['kimi','kimiwork','kimi work'],mark:'Kw'},
 {id:'codebuddy',name:'CodeBuddy',roots:['.codebuddy'],presenceRoots:['Library/Application Support/CodeBuddyExtension','.codebuddy.json'],skills:['skills'],instruction:'CODEBUDDY.md',cli:['codebuddy'],apps:['codebuddy'],mark:'Cb'},
 {id:'workbuddy',name:'WorkBuddy',roots:['.workbuddy'],skills:['skills'],instruction:'SOUL.md',memory:'MEMORY.md',cli:['workbuddy'],apps:['workbuddy'],mark:'Wb'},
 {id:'trae-work',name:'Trae Work',roots:['.trae-cn'],skills:['skills'],shared:true,instruction:'rules/user_rules.md',memory:'memory/user_profile.md',cli:['trae','trae-cn'],apps:['trae','trae cn','trae-cn','trae work'],mark:'Tr'},
 {id:'opencode',name:'OpenCode',roots:['.config/opencode'],presenceRoots:['.local/share/opencode'],skills:['skills','skill'],shared:true,instruction:'AGENTS.md',cli:['opencode'],apps:['opencode'],mark:'Oc'},
 {id:'kimi-code',name:'Kimi Code',roots:['.kimi-code','.kimi'],skills:['skills'],shared:true,instruction:'AGENTS.md',cli:['kimi','kimi-code'],apps:[],mark:'Kc'},
 {id:'openclaw',name:'OpenClaw',roots:['.openclaw'],skills:['workspace/skills','skills'],instruction:'workspace/AGENTS.md',memory:'workspace/MEMORY.md',cli:['openclaw'],apps:['openclaw'],mark:'Ow'},
 {id:'dumate',name:'百度搭子',roots:['Library/Application Support/qianfan-desktop-app/qianfan_desk_xdg','AppData/Roaming/qianfan-desktop-app/qianfan_desk_xdg'],accountMarker:'config/opencode',skills:['data/skills/user'],instruction:'config/opencode/AGENTS.md',memory:'config/opencode/MEMORY.md',cli:[],apps:['dumate','百度搭子','qianfan-desktop-app'],mark:'搭'},
 {id:'qwenwork',name:'千问办公',roots:['.qwenworkcn'],presenceRoots:['Library/Application Support/QwenWorkCN','AppData/Roaming/QwenWorkCN'],skills:['skills'],instruction:'awareness/main/AGENTS.md',memory:'awareness/main/MEMORY.md',cli:[],apps:['qwenworkcn','qwenwork','千问办公'],mark:'千'},
 {id:'minimax-agent',name:'MiniMax Agent',roots:['.minimax'],skills:['skills'],memory:'memory/user.md',cli:[],apps:['minimax agent','minimax','minimaxagent'],mark:'Mm'},
 {id:'antigravity',name:'Antigravity',roots:['.gemini'],skills:['config/skills'],instruction:'GEMINI.md',cli:['antigravity'],apps:['antigravity'],mark:'Ag'},
 {id:'cursor',name:'Cursor',roots:['.cursor'],skills:['skills'],shared:true,cli:['cursor'],apps:['cursor'],mark:'Cu'},
];
const isDir = async p => {try {return (await lstat(p)).isDirectory()} catch {return false}};
const normalize = name => name.toLowerCase().replace(/\.app$/u,'').replace(/[ _-]/gu,'');

export async function builtinAgentProfiles(home, env = process.env) {
 return Promise.all(AGENT_CATALOG.map(async a => {
  let candidates=a.roots.map(r=>path.join(home,r));
  if(a.id==='codex'&&home===os.homedir()&&env.CODEX_HOME)candidates=[path.resolve(env.CODEX_HOME),...candidates];
  let existing=[];for(const p of candidates)if(await isDir(p))existing.push(p);
  let root=existing[0]||candidates[0];
  if(a.accountMarker&&await isDir(root)){
   const accounts=[];
   for(const entry of (await readdir(root,{withFileTypes:true})).slice(0,200))if(entry.isDirectory()&&entry.name!=='global'&&await isDir(path.join(root,entry.name,a.accountMarker)))accounts.push(path.join(root,entry.name));
   if(accounts.length){existing=accounts.sort();root=existing[0]}
  }
  const contentRoots=[...new Set([root,...existing])];
  const skillRoots=[...new Set(contentRoots.flatMap(r=>a.skills.map(s=>path.join(r,s))))];
  if(a.shared)skillRoots.push(path.join(home,'.agents','skills'));
  const skillsRoot=a.id==='codex'?path.join(home,'.agents','skills'):path.join(root,a.skills[0]);
  return {id:a.id,name:a.name,root,contentRoots,presenceRoots:[...candidates,...(a.presenceRoots||[]).map(r=>path.join(home,r))],skillsRoot,skillRoots,instructionFile:a.instruction||'',memoryFile:a.memory||'',builtin:true,mark:a.mark,note:a.id==='codex'?'共享 Skills 与用户指令；兼容读取旧目录。':'检测标准内容目录；迁移前核对目标路径。'};
 }));
}

export function createAgentDiscovery({home=os.homedir(),platform=process.platform,env=process.env,appDirectories,cliDirectories,spotlight,now=Date.now}={}) {
 let cached;
 const appDirs=appDirectories|| (platform==='darwin'?['/Applications',path.join(home,'Applications'),'/System/Applications']:platform==='win32'?[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],path.join(home,'AppData/Local/Programs')].filter(Boolean):['/opt','/usr/share/applications',path.join(home,'.local/share/applications')]);
 const cliDirs=cliDirectories||[...(env.PATH||'').split(path.delimiter),path.join(home,'.local/bin'),path.join(home,'.cargo/bin'),path.join(home,'.npm-global/bin'),path.join(home,'.bun/bin'),path.join(home,'.kimi-code/bin'),path.join(home,'.hermes/venv/bin'),'/opt/homebrew/bin','/usr/local/bin'].filter(Boolean);
 async function appInventory(warnings) {
  const found=new Set();let visited=0;
  async function visit(root,depth=0){
   let entries;try{entries=await readdir(root,{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')warnings.push('应用目录不可读取：'+root);return}
   for(const entry of entries){if(++visited>10000){warnings.push('应用目录索引达到上限');return}const p=path.join(root,entry.name);if(entry.isSymbolicLink())continue;if(/\.app$/iu.test(entry.name)||/\.exe$/iu.test(entry.name))found.add(p);else if(entry.isDirectory()&&depth<3)await visit(p,depth+1)}
  }
  for(const p of appDirs)await visit(p);
  if(platform==='darwin')try{
   const rows=spotlight?await spotlight():home===os.homedir()?(await exec('/usr/bin/mdfind',['kMDItemContentType == "com.apple.application-bundle"'],{timeout:4000,maxBuffer:2*1024*1024})).stdout.split('\n'):[];
   for(const p of rows)if(path.isAbsolute(p)&&p.endsWith('.app'))found.add(p);
  }catch{warnings.push('Spotlight 应用索引不可用；已扫描标准应用目录')}
  return [...found];
 }
 async function bundleId(app) {
  if(platform!=='darwin'||!app.endsWith('.app'))return '';
  try{return (await exec('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',path.join(app,'Contents/Info.plist')],{timeout:1000,maxBuffer:4096})).stdout.trim()}catch{return ''}
 }
 async function scan({refresh=false}={}) {
  if(!refresh&&cached&&now()-cached.at<30000)return cached;
  const warnings=[],apps=await appInventory(warnings),results={};
  for(const a of AGENT_CATALOG){
   const evidence=[];
   for(const app of apps){const name=normalize(path.basename(app).replace(/\.exe$/iu,''));if(!a.apps.some(n=>normalize(n)===name))continue;
    if(a.id==='codex'&&name==='chatgpt'&&!(a.bundleIds||[]).includes(await bundleId(app)))continue;
    try{if((await stat(app)).isDirectory()||/\.exe$/iu.test(app))evidence.push({kind:'application',path:app})}catch{}
   }
   for(const dir of [...new Set(cliDirs)])for(const name of a.cli)for(const suffix of platform==='win32'?['.exe','.cmd','']:['']){
    const file=path.join(dir,name+suffix);try{const s=await stat(file);if(!s.isFile()||platform!=='win32'&&!(s.mode&0o111))continue;await access(file);const resolved=await realpath(file);if(!evidence.some(e=>e.kind==='cli'&&e.resolved===resolved))evidence.push({kind:'cli',path:file,resolved})}catch{}
   }
   results[a.id]={installed:evidence.length>0,evidence};
  }
  cached={at:now(),results,warnings,scope:['系统应用目录','Spotlight 应用索引（macOS）','PATH 与常见 CLI 目录','Agent 标准内容目录及别名','手动登记目录']};return cached;
 }
 return {scan};
}
