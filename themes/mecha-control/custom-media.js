/* Local user assets only. No uploads, external URLs or localStorage binaries. */
window.__AIYOU_THEME_MEDIA_STORE__ = (() => {
 'use strict';
 const dbName='aiyoucodex.theme-media.v1',maxVideo=100*1024*1024,maxImage=20*1024*1024;
 let connection=null;
 function db(){if(connection)return connection;connection=new Promise((resolve,reject)=>{
  const request=indexedDB.open(dbName,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('assets',{keyPath:'id'});
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  request.onerror=()=>reject(Error('无法访问本机素材存储'));
  request.onblocked=()=>reject(Error('素材存储暂时被其他窗口占用'));
 });return connection;}
 async function operation(mode,run){const database=await db();return new Promise((resolve,reject)=>{
  const tx=database.transaction('assets',mode),request=run(tx.objectStore('assets'));let result;
  request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);
  tx.onabort=tx.onerror=()=>reject(Error('素材保存失败：请检查本机存储空间'));
 });}
 async function prepare(file){
  if(!(file instanceof Blob)||!file.size)throw Error('请选择非空图片、GIF 或视频');
  const b=new Uint8Array(await file.slice(0,16).arrayBuffer()),ascii=(start,end)=>String.fromCharCode(...b.slice(start,end));let type,mime;
  if(ascii(0,6)==='GIF87a'||ascii(0,6)==='GIF89a'){type='gif';mime='image/gif';}
  else if(b[0]===137&&ascii(1,4)==='PNG'){type='image';mime='image/png';}
  else if(b[0]===255&&b[1]===216&&b[2]===255){type='image';mime='image/jpeg';}
  else if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'){type='image';mime='image/webp';}
  else if(ascii(4,8)==='ftyp'){type='video';mime='video/mp4';}
  else if(b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163){type='video';mime='video/webm';}
  else throw Error('支持 PNG、JPG、WebP、GIF、MP4、WebM；此文件格式不受支持');
  if(file.size>(type==='video'?maxVideo:maxImage))throw Error(type==='video'?'视频不能超过 100 MB':'图片 / GIF 不能超过 20 MB');
  const blob=file.slice(0,file.size,mime),url=URL.createObjectURL(blob),element=document.createElement(type==='video'?'video':'img');
  try{
   if(type==='video'){element.muted=true;element.playsInline=true;element.preload='auto';}
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('素材解码超时，请换用兼容格式')),15000);
    element.addEventListener(type==='video'?'loadeddata':'load',()=>{clearTimeout(timer);resolve();},{once:true});
    element.addEventListener('error',()=>{clearTimeout(timer);reject(Error('无法播放该素材，请检查文件或视频编码'));},{once:true});
    element.src=url;if(type==='video')element.load();
   });
   const width=type==='video'?element.videoWidth:element.naturalWidth,height=type==='video'?element.videoHeight:element.naturalHeight;
   if(!width||!height||width*height>32000000)throw Error('素材尺寸无效或超过 3200 万像素');
   const scale=Math.min(1,1920/width,1080/height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
   canvas.getContext('2d').drawImage(element,0,0,canvas.width,canvas.height);
   const poster=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!poster)throw Error('无法生成素材静态预览');
   const id=crypto.randomUUID(),meta={id,name:String(file.name||'自定义背景').slice(0,160),type,mime,bytes:file.size,width,height};
   await operation('readwrite',store=>store.put({id,meta,blob,poster}));
   return meta;
  }finally{if(type==='video'){element.pause();element.removeAttribute('src');element.load();}URL.revokeObjectURL(url);}
 }
 return {prepare,get:id=>operation('readonly',store=>store.get(id)),remove:id=>operation('readwrite',store=>store.delete(id))};
})();
