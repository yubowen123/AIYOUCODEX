import assert from 'node:assert/strict';
import test from 'node:test';
import {buildThemePackage} from '../lib/theme-build.mjs';
import {buildThemeCatalog} from '../lib/theme-catalog.mjs';

test('current production skins compile into one catalog with isolated settings and complete motion',async()=>{
 const entries=[];
 for(const id of ['mecha-control','pink-candy']){
  const b=await buildThemePackage(`themes/${id}`);
  assert.equal(b.manifest.id,id);assert.ok(b.contrast.every(p=>p.ratio>=p.minimum));
  assert.ok(b.assetBytes<=b.manifest.limits.maxBundleBytes);
  entries.push({id,name:b.manifest.name,prefKey:b.prefKey,source:b.compiled,frameSource:b.frameSource});
 }
 assert.notEqual(entries[0].prefKey,entries[1].prefKey);
 const catalog=buildThemeCatalog(entries,{initial:'mecha-control'});
 new Function(catalog.source);new Function(catalog.frameSource);
 assert.ok(catalog.source.includes('mecha-control')&&catalog.source.includes('pink-candy'));
});
