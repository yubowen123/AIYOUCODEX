import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm, readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {findNpmCli, installClaudeDependencies} from "../scripts/setup-claude-dependencies.mjs";

test("Claude dependency staging uses locked production packages and never runs install scripts", async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),"aiyou-dependency-install-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const cli=path.join(root,"npm-cli.js");await writeFile(cli,"");
  const env={PATH:"",npm_execpath:cli};
  assert.equal(await findNpmCli({env}),cli);
  assert.equal(await installClaudeDependencies({root,env:{PATH:""},nodePath:path.join(root,"node")}),false);
  await assert.rejects(installClaudeDependencies({root,env,run:()=>({status:1})}),/previous runtime preserved/);
  for(const name of ["@anthropic-ai/claude-agent-sdk","smol-toml"]){const dir=path.join(root,"node_modules",name);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,"package.json"),"{}");}
  assert.equal(await installClaudeDependencies({root,env,run:(node,args,options)=>{
    assert.equal(node,process.execPath);assert.deepEqual(args.slice(1),["ci","--omit=dev","--ignore-scripts","--no-audit","--no-fund"]);
    assert.equal(options.cwd,root);assert.equal(options.stdio,"ignore");assert.equal(options.timeout,120000);assert.equal(options.killSignal,"SIGKILL");return {status:0};
  }}),true);
  await assert.rejects(installClaudeDependencies({root,env,run:()=>({status:null,error:{code:"ETIMEDOUT"}})}),/previous runtime preserved/);
  const mac=await readFile(new URL("../install.sh",import.meta.url),"utf8");
  const win=await readFile(new URL("../install.ps1",import.meta.url),"utf8");
  assert.ok(mac.indexOf("setup-claude-dependencies.mjs")<mac.indexOf('mv "${INSTALL_DIR}"'));
  assert.ok(win.indexOf("setup-claude-dependencies.mjs")<win.indexOf("Move-Item -LiteralPath $fullInstallDir"));
});
