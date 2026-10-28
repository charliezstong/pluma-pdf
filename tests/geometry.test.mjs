import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({entryPoints:['src/geometry.ts'],bundle:true,format:'esm',write:false,platform:'node'});
const {cappedRasterSize,targetImageSize} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test('FILL preserves enough source pixels for the cropped short edge; FIT uses contained size',()=>{
  assert.deepEqual(targetImageSize(6000,4000,600,600,2,'FILL'),{width:1800,height:1200});
  assert.deepEqual(targetImageSize(6000,4000,600,600,2,'FIT'),{width:1200,height:800});
  assert.deepEqual(targetImageSize(600,400,1600,900,2,'FILL'),{width:600,height:400});
});
test('render caps aspect ratio, pixel count and edge at extreme sizes',()=>{
  for(const [w,h,s] of [[1920,1080,2],[30000,30000,4],[500000,10,3],[0.1,1000,10],[100,100000,2]]){
    const r=cappedRasterSize(w,h,s);assert.ok(r.width<=8192&&r.height<=8192);assert.ok(r.width*r.height<=24_000_000);assert.ok(r.scale<=s);assert.ok(Math.abs(r.width-w*r.scale)<1.01&&Math.abs(r.height-h*r.scale)<1.01);
  }
});
test('invalid geometry is rejected before exporting',()=>{for(const n of [0,-1,NaN,Infinity])assert.throws(()=>cappedRasterSize(n,100,1));assert.throws(()=>targetImageSize(10,10,10,10,1,'CROP'));});
