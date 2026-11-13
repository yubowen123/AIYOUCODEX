import assert from "node:assert/strict";
import { test } from "node:test";
import { createHallRoster } from "../vendor/codex-taskboard/server/task-hall-roster.mjs";

test("hall roster follows program evidence, preserves unknown usage, and removes absent agents after rescan",async()=>{
  let now=0, scans=0;
  const results={codex:{installed:true,evidence:[{path:"private"}]},dsh:{installed:true},
    "claude-code":{installed:true},hermes:{installed:false,hasLocalData:true}};
  const entries=["codex","dsh","claude-code","hermes"].map(id=>({id,name:id,root:"/private"}));
  const roster=createHallRoster({discovery:{async scan(){scans++;return {results};}},profiles:async()=>entries,
    clock:()=>now,ttlMs:50,readUsage:async({id})=>id==="codex"?230:id==="dsh"?0:null});
  const [first,simultaneous]=await Promise.all([roster(),roster()]);
  assert.equal(scans,1);
  assert.deepEqual(first,simultaneous);
  assert.deepEqual(first.items,[
    {id:"codex",name:"codex",usageCount:230,usageBasis:"sessions"},
    {id:"dsh",name:"dsh",usageCount:0,usageBasis:"sessions"},
    {id:"claude",name:"claude-code",usageCount:null,usageBasis:"unknown"},
  ]);
  results.codex.installed=false; now=49;
  assert.equal((await roster()).items.length,3);
  now=50;
  assert.deepEqual((await roster()).items.map(x=>x.id),["dsh","claude"]);
});
