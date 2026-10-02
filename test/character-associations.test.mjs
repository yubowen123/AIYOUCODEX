import assert from "node:assert/strict";
import test from "node:test";
import { deriveCharacterRelations, keepCharacterFamiliesAdjacent, inferCharacterName, normalizeCharacterMetadata } from "../vendor/codex-workspace-enhancer/asset-browser/character-associations.js";
import { AssetLibraryPager } from "../vendor/codex-workspace-enhancer/asset-browser/asset-library-pagination.js";
import { imageDescriptor, visualSimilarity } from "../vendor/codex-workspace-enhancer/asset-browser/public/character-visual.js";

const image = (id, title, time=1) => ({id, title, name:`${title}.png`, sourcePath:`/fixture/${id}.png`, kind:"image", category:"角色", smartGroup:"asset", mtimeMs:time});
test("named role variants form project-scoped families, random portraits do not", () => {
  const assets=[image("base","韩立_日常",1),image("other","南宫婉_写实",2),image("child","韩立_战斗",3),image("random","u34364364",4)];
  const rows=deriveCharacterRelations(assets,{projectId:"p", associations:{"/fixture/child.png":{references:["/fixture/base.png"]}}});
  assert.equal(rows[0].character.name,"韩立");
  assert.equal(rows[2].character.state,"战斗");
  assert.equal(rows[1].character.style,"写实");
  assert.equal(rows[2].character.groupId,rows[0].character.groupId);
  assert.equal(rows[2].character.parentAssetId,"base");
  assert.equal(rows[0].character.count,2);
  assert.equal(rows[3].character.groupId,"");
  assert.notEqual(deriveCharacterRelations(assets,{projectId:"other"})[0].character.groupId,rows[0].character.groupId);
  assert.equal(inferCharacterName(image("x","角色海报")),"");
  assert.equal(inferCharacterName(image("x","exec-49ee8dc6-29fb-4d78-bda6-50e798bb351b")),"");
  assert.equal(inferCharacterName(image("x","image-finished")),"");
  assert.equal(inferCharacterName(image("x","四宫格-成年女性角色参考")),"");
  assert.equal(inferCharacterName(image("x","画布图片-13-14-司空寂-百面祭服-四宫格")),"司空寂");
  assert.equal(inferCharacterName(image("x","画布图片-08-08-周铎-沉环灯路维修服")),"周铎");
  assert.equal(inferCharacterName({...image("x","9x16"),category:"其他"}),"");
});
test("manual identity, exclusion and derivation override filename clues without mutating sources", () => {
  const assets=[image("a","韩立_日常"),image("b","韩立_战斗"),image("c","unknown")];
  const rows=deriveCharacterRelations(assets,{projectId:"p",metadata:{
    "/fixture/a.png":{character:{name:"沈墨",state:"少年",style:"水墨"}},
    "/fixture/b.png":{character:{name:"韩立",excluded:true}},
    "/fixture/c.png":{character:{name:"",parentAssetId:"a"}},
  }});
  assert.equal(rows[0].character.source,"manual");
  assert.equal(rows[0].character.style,"水墨");
  assert.equal(rows[1].character.groupId,"");
  assert.equal(rows[2].character.name,"沈墨");
  assert.equal(rows[2].character.depth,1);
  assert.equal(assets[0].character,undefined);
  assert.equal(normalizeCharacterMetadata({name:"  韩立\u0000 ",state:"a"}).name,"韩立");
});
test("ambiguous references never merge distinct or unnamed roles; cyclic relations are bounded", () => {
  const assets=[image("a","韩立_日常"),image("b","南宫婉_日常"),image("c","unknown")];
  const rows=deriveCharacterRelations(assets,{projectId:"p",associations:{"/fixture/c.png":{references:["/fixture/a.png","/fixture/b.png"]}}});
  assert.equal(rows[2].character.name,"");
  assert.deepEqual(rows[2].character.candidateParentIds,["a","b"]);
  const derived=deriveCharacterRelations(assets,{projectId:"p",associations:{"/fixture/c.png":{references:["/fixture/a.png"],prompt:"保持同一角色，更换服装与状态"}}});
  assert.equal(derived[2].character.name,"韩立");
  assert.equal(derived[2].character.parentAssetId,"a");
  assert.equal(derived[2].character.source,"reference-rule");
  const cycle=deriveCharacterRelations(assets,{metadata:{"/fixture/a.png":{character:{name:"A",parentAssetId:"c"}},"/fixture/c.png":{character:{name:"A",parentAssetId:"a"}}}});
  assert.ok(cycle.some(a=>a.character.parentAssetId===""));
});
test("families are adjacent before pagination, can be filtered, searched and ungrouped", () => {
  const assets=deriveCharacterRelations([image("a","韩立_日常",1),image("b","南宫婉_日常",2),image("c","韩立_战斗",3)],{projectId:"p"});
  const pager=new AssetLibraryPager(), request={projectId:"p",revision:"1",assets};
  const first=pager.page({...request,filters:{limit:1}}),second=pager.page({...request,filters:{limit:1,offset:1}});
  assert.equal(first.assets[0].id,"a"); assert.equal(second.assets[0].id,"c");
  assert.equal(pager.page({...request,filters:{related:false}}).assets[0].id,"c");
  assert.equal(pager.page({...request,filters:{characterId:assets[0].character.groupId}}).filteredTotal,2);
  assert.equal(pager.page({...request,filters:{query:"韩立"}}).filteredTotal,2);
  const many=Array.from({length:140000},(_,i)=>({id:String(i),character:{groupId:"same",baseAssetId:"0",depth:0}}));
  assert.equal(keepCharacterFamiliesAdjacent(many).length,many.length,"large families do not overflow a spread call stack");
});
test("local visual matching rejects blank images and never implies identity", () => {
  const pixels=new Uint8ClampedArray(1024), opposite=new Uint8ClampedArray(1024);
  for(let i=0;i<256;i++)for(let c=0;c<4;c++){pixels[i*4+c]=c===3?255:i%16<8?32:220;opposite[i*4+c]=c===3?255:i%16<8?220:32;}
  const a=imageDescriptor(pixels);
  assert.ok(visualSimilarity(a,a)>.999);
  assert.ok(visualSimilarity(a,imageDescriptor(opposite))<.5);
  assert.equal(visualSimilarity(imageDescriptor(new Uint8ClampedArray(1024)),a),0);
  assert.throws(()=>imageDescriptor([]));
});
