import assert from "node:assert/strict";
import test from "node:test";
import {activateLaunchAgent} from "../lib/launch-agent.mjs";

test("installation enables a disabled service and retries launchd bootout transition", async () => {
  const calls = []; let bootstraps = 0;
  await activateLaunchAgent({domain:"gui/42",label:"test",plistPath:"/tmp/test.plist",wait:async()=>{},run:(_cmd,args)=>{
    calls.push(args); if(args[0]==="bootstrap" && ++bootstraps<3)return {status:5,stderr:"transition"}; return {status:0};
  }});
  assert.deepEqual(calls[0],["enable","gui/42/test"]);
  assert.equal(bootstraps,3);
  assert.deepEqual(calls.at(-1),["kickstart","-k","gui/42/test"]);
});
test("existing theme service is enabled and kept running without replacement", async()=>{
  const calls=[];
  await activateLaunchAgent({domain:"gui/42",label:"theme",plistPath:"/tmp/theme",replace:false,run:(_cmd,args)=>{calls.push(args);return {status:0};}});
  assert.deepEqual(calls,[["enable","gui/42/theme"],["print","gui/42/theme"],["kickstart","gui/42/theme"]]);
});
test("persistent bootstrap failure is reported after bounded retries",async()=>{
  let attempts=0;
  await assert.rejects(activateLaunchAgent({domain:"gui/42",label:"test",plistPath:"/tmp/test",wait:async()=>{},run:(_cmd,args)=>args[0]==="bootstrap"?(attempts++,{status:5,stderr:"unavailable"}):{status:0}}),/unavailable/);
  assert.equal(attempts,5);
});
