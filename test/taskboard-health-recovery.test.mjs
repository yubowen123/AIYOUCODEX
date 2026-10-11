import test from 'node:test';
import assert from 'node:assert/strict';
import {probeInjectionConnection,reconcileInjectionRuntime,selectCodexTargets,injectionRuntimeNeedsRefresh} from '../vendor/codex-taskboard/scripts/codex-injector-runtime.mjs';

function connection(){return{closed:false,closes:0,close(){this.closed=true;this.closes++}};}
const unavailable=async()=>{throw new Error('renderer health unavailable')};

test('one transient health failure preserves the connection and successful health resets its failure budget',async()=>{
 const c=connection();assert.equal((await probeInjectionConnection(c,unavailable)).action,'retry');
 assert.equal(c.closes,0);assert.equal(c.taskboardHealthFailures,1);
 const status={sourceHash:'current',entryMounted:true};assert.deepEqual(await probeInjectionConnection(c,async()=>status),{action:'ready',status});
 assert.equal(c.taskboardHealthFailures,0);
 assert.equal((await probeInjectionConnection(c,unavailable)).action,'retry');assert.equal(c.closes,0);
});

test('three consecutive malformed or timed-out reads retire a stuck transport, then fresh health preserves an already healthy panel',async()=>{
 const c=connection();await probeInjectionConnection(c,unavailable);await probeInjectionConnection(c,unavailable);
 assert.equal((await probeInjectionConnection(c,unavailable)).action,'reconnect');assert.equal(c.closes,1);
 const fresh=connection(),status={version:'current',sourceHash:'current',entryMounted:true,pageMounted:true,pageVisible:true,scriptIdentifier:'registered'};
 const probe=await probeInjectionConnection(fresh,async()=>status);assert.equal(probe.action,'ready');
 const calls=[];await reconcileInjectionRuntime({currentStatus:probe.status,sourceHash:'current',source:'current',openRequested:false,removeRegisteredSource:async()=>calls.push('remove'),registerCurrentSource:async()=>{calls.push('register');return'registered'},evaluateCurrentSource:async()=>calls.push('evaluate'),publishRegistration:async()=>calls.push('publish'),reopen:async()=>calls.push('open')});
 assert.equal(injectionRuntimeNeedsRefresh(probe.status,'current'),false);assert.equal(calls.includes('open'),false);
});

test('fresh health that proves the module missing evaluates its source without refreshing the host',async()=>{
 const c=connection(),probe=await probeInjectionConnection(c,async()=>({sourceHash:null,entryMounted:false,scriptIdentifier:null}));
 const calls=[];await reconcileInjectionRuntime({currentStatus:probe.status,sourceHash:'current',source:'current',openRequested:false,removeRegisteredSource:async()=>calls.push('remove'),registerCurrentSource:async()=>{calls.push('register');return'new'},evaluateCurrentSource:async()=>calls.push('evaluate'),publishRegistration:async()=>calls.push('publish'),reopen:async()=>calls.push('open')});
 assert.ok(calls.includes('evaluate'));assert.equal(calls.includes('open'),false);
});

test('Taskboard reconnect selects the actual main renderer regardless of chat title and excludes detached, dictation, overlay and external pages',()=>{
 const make=(url,title='项目管理测试')=>({type:'page',url,title,webSocketDebuggerUrl:'ws://fixture'});
 const main=make('app://-/index.html');
 assert.deepEqual(selectCodexTargets([main,make('app://-/detached-window.html?initialRoute=%2Fdetached-window'),make('app://-/index.html?initialRoute=/avatar-overlay'),make('app://-/index.html?initialRoute=%2Fglobal-dictation'),make('https://example.test','Codex'),make('bad-url')]),[main]);
});
