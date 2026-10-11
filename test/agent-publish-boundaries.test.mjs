import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAgentWorkspace} from '../lib/agent-workspace.mjs';
import {createAgentConversations} from '../lib/agent-conversations.mjs';

async function fixture(t) {
 const root=await realpath(await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'agent-publish-boundary-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home'),agent={id:'codex',name:'Codex',root:path.join(home,'.codex')};
 const file=path.join(agent.root,'sessions','fixture','rollout.jsonl');
 await mkdir(path.dirname(file),{recursive:true});
 await writeFile(file,[{type:'session_meta',payload:{id:'fixture',cwd:path.join(root,'project')}},
  {type:'user',customTitle:'Safe JSONL title',message:{role:'user',content:'Synthetic user message'}}].map(row=>JSON.stringify(row)).join('\n'));
 return {root,home,agent,file,stateRoot:path.join(root,'state')};
}
function catalog(file,rollouts) {
 const db=new DatabaseSync(file);
 try {
  db.exec('CREATE TABLE threads(id TEXT,title TEXT,updated_at INTEGER,cwd TEXT,rollout_path TEXT)');
  for(const [index,rollout] of rollouts.entries())db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)')
   .run('fixture-'+index,'SQLite metadata title',123,'',rollout);
 }finally{db.close()}
}
async function linkFixture(t,target,file,type) {
 try{await symlink(target,file,type);return true}
 catch(e){if(process.platform==='win32'&&['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('Windows fixture cannot create this symlink');return false}throw e}
}

test('private-key conversation preview rejects before persisting a plan or writing target files',async t=>{
 const f=await fixture(t);
 // Deliberately synthetic text: no real private key or credential is used.
 const synthetic=['-----BEGIN PRIVATE KEY-----','SYNTHETIC FIXTURE ONLY','-----END PRIVATE KEY-----'].join('\n');
 await writeFile(f.file,JSON.stringify({type:'user',cwd:path.join(f.root,'project'),customTitle:'Synthetic secret fixture',message:{role:'user',content:synthetic}})+'\n');
 const service=createAgentWorkspace({home:f.home,stateRoot:f.stateRoot,discoveryOptions:{appDirectories:[],cliDirectories:[],spotlight:async()=>[]}});
 const session=(await service.request({action:'sessions',agentId:'codex'})).sessions[0];
 await assert.rejects(service.request({action:'preview',sourceId:'codex',targetIds:['claude-code','workbuddy'],resourceIds:['conversation:'+session.id],conflict:'skip'}),/凭证.*预览未保存/);
 const plans=await readdir(path.join(f.stateRoot,'plans')).catch(e=>{if(e.code==='ENOENT')return [];throw e});
 assert.deepEqual(plans,[]);
 await assert.rejects(readdir(path.join(f.home,'.claude')),{code:'ENOENT'});
});

test('Codex linked SQLite catalog is rejected and safe JSONL metadata remains available',async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside.sqlite');catalog(outside,[f.file]);
 if(!await linkFixture(t,outside,path.join(f.agent.root,'state_5.sqlite')))return;
 const before=await readFile(outside);let calls=0;
 const service=createAgentConversations({readCatalog:async()=>{calls++;return []}});
 const list=await service.list(f.agent);
 assert.equal(calls,0);assert.equal(list.sessions.length,1);assert.equal(list.sessions[0].title,'Safe JSONL title');
 assert(list.warnings.some(w=>w.includes('符号链接')));assert.deepEqual(await readFile(outside),before);
});

test('Codex linked rollout header prevents shared catalog inspection and falls back to safe files',async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside.jsonl'),linked=path.join(path.dirname(f.file),'linked.jsonl');
 await writeFile(outside,JSON.stringify({type:'session_meta',payload:{originator:'interactive_agent_studio'}})+'\n');
 if(!await linkFixture(t,outside,linked))return;
 catalog(path.join(f.agent.root,'state_5.sqlite'),[f.file,linked]);let calls=0;
 const service=createAgentConversations({readCatalog:async()=>{calls++;return []}}),list=await service.list(f.agent);
 assert.equal(calls,0);assert.equal(list.sessions.length,1);assert.equal(list.sessions[0].title,'Safe JSONL title');
 assert(list.warnings.some(w=>w.includes('Codex 元数据未读取')&&w.includes('符号链接')));
});

test('linked SQLite sidecars and linked conversation directories are not followed',async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside-sidecar');await writeFile(outside,'synthetic SQLite sidecar');
 catalog(path.join(f.agent.root,'state_5.sqlite'),[f.file]);
 if(!await linkFixture(t,outside,path.join(f.agent.root,'state_5.sqlite-wal')))return;
 let calls=0;const service=createAgentConversations({readCatalog:async()=>{calls++;return []}});
 assert((await service.list(f.agent)).warnings.some(w=>w.includes('符号链接')));assert.equal(calls,0);
 const linkedRoot=path.join(f.root,'linked-agent');await mkdir(linkedRoot);
 if(!await linkFixture(t,path.join(f.agent.root,'sessions'),path.join(linkedRoot,'sessions'),process.platform==='win32'?'junction':'dir'))return;
 const linked=await service.list({...f.agent,id:'kimi-code',root:linkedRoot});
 assert.equal(linked.sessions.length,0);assert(linked.warnings.some(w=>w.includes('符号链接')));
});

test('safe Codex SQLite catalog still supplies native titles through the guarded adapter',async t=>{
 const f=await fixture(t);catalog(path.join(f.agent.root,'state_5.sqlite'),[f.file]);
 const list=await createAgentConversations().list(f.agent);
 assert.equal(list.sessions.length,1);assert.equal(list.sessions[0].title,'SQLite metadata title');
 assert.equal(list.sessions[0].updatedAt,123000);assert.deepEqual(list.warnings,[]);
});

test('Windows application evidence exposes no native launch capability and does not launch',async t=>{
 const f=await fixture(t),apps=path.join(f.root,'apps');await mkdir(apps);await writeFile(path.join(apps,'Codex.exe'),'synthetic application metadata');
 const service=createAgentWorkspace({home:f.home,stateRoot:f.stateRoot,platform:'win32',discoveryOptions:{appDirectories:[apps],cliDirectories:[]}});
 const agent=(await service.snapshot()).agents.find(a=>a.id==='codex');
 assert.equal(agent.installed,true);assert.equal(agent.canLaunchApplication,false);
 await assert.rejects(service.request({action:'launch',agentId:'codex'}),/当前系统未接入/);
});

test('macOS detected app exposes launch capability; read-only refresh does not open it',async t=>{
 const f=await fixture(t),apps=path.join(f.root,'apps');await mkdir(path.join(apps,'Codex.app'),{recursive:true});let calls=0;
 const service=createAgentWorkspace({home:f.home,stateRoot:f.stateRoot,platform:'darwin',launchApplication:async()=>calls++,discoveryOptions:{appDirectories:[apps],cliDirectories:[],spotlight:async()=>[]}});
 assert.equal((await service.snapshot()).agents.find(a=>a.id==='codex').canLaunchApplication,true);
 assert.equal(calls,0);
});
