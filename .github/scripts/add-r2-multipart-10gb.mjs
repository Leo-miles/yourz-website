import fs from "node:fs";
import path from "node:path";
const root=process.argv[2]||"app";
const hf=path.join(root,"src/handler.js"), af=path.join(root,"public/app.js"), ix=path.join(root,"public/index.html");
let h=fs.readFileSync(hf,"utf8"), a=fs.readFileSync(af,"utf8"), html=fs.readFileSync(ix,"utf8");
if(!h.includes("YOURZ_R2_MULTIPART_10GB_V1")){
 h=h.replace("const MAX_PRODUCT_FILE_BYTES = 20 * 1024 * 1024;","const MAX_PRODUCT_FILE_BYTES = 10_000_000_000;\nconst MAX_SINGLE_PRODUCT_FILE_BYTES = 20 * 1024 * 1024;");
 h=h.replace("const MAX_TOTAL_PRODUCT_FILE_BYTES = 9_000_000_000;","const MAX_TOTAL_PRODUCT_FILE_BYTES = 20_000_000_000;");
 h=h.replace("if (size > MAX_PRODUCT_FILE_BYTES) fail(413, 'Each file must be 20 MB or smaller / 单个文件不能超过20MB');","if (size > MAX_SINGLE_PRODUCT_FILE_BYTES) fail(413, 'Use multipart upload for files over 20 MB / 超过20MB请使用分片上传');");
 h=h.replace("Shared file storage safety limit reached (9 GB). Delete unused files before uploading more. / 共享文件存储达到9GB安全上限，请删除不再需要的文件后再上传","Shared file storage safety limit reached (20 GB). Delete unused files before uploading more. / 共享文件存储达到20GB安全上限，请删除不再需要的文件后再上传");
 const schema=h.match(/^([ \t]*)await db\.prepare\("CREATE TABLE IF NOT EXISTS file_upload_reservations[^"]*"\)\.run\(\);$/m);
 if(!schema)throw Error("Multipart schema anchor missing.");
 h=h.replace(schema[0],schema[0]+"\n"+schema[1]+'await db.prepare("CREATE TABLE IF NOT EXISTS multipart_file_uploads (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL)").run();');
 const anchor="  const contentMatch = route.match(";
 if(!h.includes(anchor))throw Error("Multipart route anchor missing.");
 const routes=[
'  /* YOURZ_R2_MULTIPART_10GB_V1 */',
'  if (route === "/api/files/multipart" && method === "POST") {',
'    productFileWriteGuard(request, session);',
'    const fileName=productFileName(url.searchParams.get("name")||"");',
'    const extension=fileName.includes(".")?fileName.split(".").pop().toLowerCase():"";',
'    const contentType=PRODUCT_FILE_MIME[extension]; if(!contentType)fail(415,"Unsupported file format / 不支持的文件格式");',
'    const size=Number(request.headers.get("X-File-Size")||0); if(!Number.isSafeInteger(size)||size<=0)fail(411,"Upload size is required / 缺少文件大小");',
'    if(size>MAX_PRODUCT_FILE_BYTES)fail(413,"Maximum file size is 10 GB / 单个文件最大10GB");',
'    const id=token(),objectKey="uploads/"+id;',
'    const reservation=await env.DB.prepare("INSERT INTO file_upload_reservations(id,size,created_at) SELECT ?,?,? WHERE (COALESCE((SELECT SUM(size) FROM uploaded_files),0)+COALESCE((SELECT SUM(size) FROM file_upload_reservations),0)+?)<=?").bind(id,size,stamp(),size,MAX_TOTAL_PRODUCT_FILE_BYTES).run();',
'    if(Number(reservation?.meta?.changes||0)!==1)fail(507,"Shared storage limit reached (20 GB) / 共享存储达到20GB上限");',
'    let multipart; try { multipart=await env.FILES.createMultipartUpload(objectKey,{httpMetadata:{contentType},customMetadata:{fileId:id,uploadedBy:session.userId}}); await env.DB.prepare("INSERT INTO multipart_file_uploads(id,upload_id,object_key,file_name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,multipart.uploadId,objectKey,fileName,contentType,size,session.userId,stamp()).run(); } catch(error) { if(multipart)try{await multipart.abort()}catch{} try{await env.DB.prepare("DELETE FROM file_upload_reservations WHERE id=?").bind(id).run()}catch{} fail(502,"Could not start multipart upload / 无法启动分片上传"); }',
'    return jsonResponse(request,201,{ok:true,uploadId:id,partSize:16*1024*1024,size});',
'  }',
'  const partMatch=route.match(/^\\/api\\/files\\/multipart\\/([A-Za-z0-9_-]{43})\\/part$/);',
'  if(partMatch&&method==="PUT"){',
'    productFileWriteGuard(request,session); const row=await env.DB.prepare("SELECT id,upload_id,object_key,size,uploaded_by FROM multipart_file_uploads WHERE id=?").bind(partMatch[1]).first();',
'    if(!row)fail(404,"Upload task not found / 上传任务不存在"); if(row.uploaded_by!==session.userId)fail(403,"Upload belongs to another user / 上传任务属于其他用户");',
'    const pn=Number(url.searchParams.get("partNumber")||0),chunk=16*1024*1024,count=Math.ceil(Number(row.size)/chunk),actual=Number(request.headers.get("X-Part-Size")||0);',
'    if(!Number.isInteger(pn)||pn<1||pn>count||pn>10000)fail(400,"Invalid part number / 分片序号无效"); const expected=Math.min(chunk,Number(row.size)-(pn-1)*chunk); if(actual!==expected||!request.body)fail(400,"Invalid part size / 分片大小无效");',
'    let seen=0; const guarded=request.body.pipeThrough(new TransformStream({transform(c,ctl){seen+=c.byteLength;if(seen>expected)throw Error("Part too large");ctl.enqueue(c)},flush(){if(seen!==expected)throw Error("Part size mismatch")}}));',
'    try{const u=env.FILES.resumeMultipartUpload(row.object_key,row.upload_id),result=await u.uploadPart(pn,guarded);return jsonResponse(request,200,{ok:true,partNumber:pn,etag:result.etag})}catch(error){fail(502,"Part failed; retry this part / 分片失败，请重试")}',
'  }',
'  const completeMatch=route.match(/^\\/api\\/files\\/multipart\\/([A-Za-z0-9_-]{43})\\/complete$/);',
'  if(completeMatch&&method==="POST"){',
'    productFileWriteGuard(request,session); const row=await env.DB.prepare("SELECT id,upload_id,object_key,file_name,content_type,size,uploaded_by FROM multipart_file_uploads WHERE id=?").bind(completeMatch[1]).first();',
'    if(!row)fail(404,"Upload task not found / 上传任务不存在"); if(row.uploaded_by!==session.userId)fail(403,"Upload belongs to another user / 上传任务属于其他用户");',
'    const body=await parseBody(request),parts=Array.isArray(body?.parts)?body.parts:[],count=Math.ceil(Number(row.size)/(16*1024*1024)); if(parts.length!==count||count<1||count>10000)fail(400,"Parts are incomplete / 分片不完整");',
'    for(let i=0;i<parts.length;i++)if(Number(parts[i]?.partNumber)!==i+1||typeof parts[i]?.etag!=="string"||!parts[i].etag||parts[i].etag.length>256)fail(400,"Invalid part manifest / 分片清单无效");',
'    try{await env.FILES.resumeMultipartUpload(row.object_key,row.upload_id).complete(parts.map(p=>({partNumber:Number(p.partNumber),etag:p.etag})));const at=stamp();await env.DB.batch([env.DB.prepare("INSERT INTO uploaded_files(id,file_name,content_type,size,object_key,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)").bind(row.id,row.file_name,row.content_type,row.size,row.object_key,row.uploaded_by,at),env.DB.prepare("INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)").bind(at,session.userId,"file.upload",row.file_name.slice(0,250)),env.DB.prepare("DELETE FROM file_upload_reservations WHERE id=?").bind(row.id),env.DB.prepare("DELETE FROM multipart_file_uploads WHERE id=?").bind(row.id)]);return jsonResponse(request,201,{ok:true,file:{id:row.id,file_name:row.file_name,content_type:row.content_type,size:Number(row.size),uploaded_by:row.uploaded_by,uploaded_at:at}})}catch(error){fail(502,"Could not finalize upload; retry or contact admin / 无法完成上传，请重试或联系管理员")}',
'  }',
'  const abortMatch=route.match(/^\\/api\\/files\\/multipart\\/([A-Za-z0-9_-]{43})$/);',
'  if(abortMatch&&method==="DELETE"){productFileWriteGuard(request,session);const row=await env.DB.prepare("SELECT id,upload_id,object_key,uploaded_by FROM multipart_file_uploads WHERE id=?").bind(abortMatch[1]).first();if(!row)return jsonResponse(request,200,{ok:true});if(row.uploaded_by!==session.userId)fail(403,"Upload belongs to another user / 上传任务属于其他用户");try{await env.FILES.resumeMultipartUpload(row.object_key,row.upload_id).abort()}catch{}await env.DB.batch([env.DB.prepare("DELETE FROM multipart_file_uploads WHERE id=?").bind(row.id),env.DB.prepare("DELETE FROM file_upload_reservations WHERE id=?").bind(row.id)]);return jsonResponse(request,200,{ok:true})}'
].join("\n");
 h=h.replace(anchor,routes+"\n"+anchor);
 fs.writeFileSync(hf,h);
}
if(!a.includes("YOURZ_R2_MULTIPART_10GB_V1")){
 const start=a.indexOf(" async function uploadProductFiles(files){"),end=a.indexOf("\n function bindProductFileInput()",start);
 if(start<0||end<0)throw Error("Upload UI function anchor missing.");
 const replacement=[
' async function uploadProductFiles(files){',
'  if(!canEdit())throw Error("Upload permission required / 需要上传权限");if(stale||busy)throw Error("Load latest records and finish saving first / 请先载入最新资料并完成保存");',
'  const progress=document.getElementById("productFileProgress"),input=document.getElementById("productFileInput");let done=0;const failed=[],chunkSize=16*1024*1024;productFilePage=1;',
'  for(const file of files){if(file.size<=0){failed.push(file.name+": empty");continue}if(file.size>10_000_000_000){failed.push(file.name+": exceeds 10 GB");continue}let id="",complete=false;',
'   try{if(progress)progress.textContent="Starting / 正在创建任务: "+file.name;const s=await fetch("/api/files/multipart?name="+encodeURIComponent(file.name),{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"X-CSRF-Token":session?.csrf||"","X-File-Size":String(file.size)}});let sd={};try{sd=await s.json()}catch{}if(!s.ok)throw Error(sd.error||("HTTP "+s.status));id=sd.uploadId;if(!id)throw Error("No upload session");',
'    const parts=[],count=Math.ceil(file.size/chunkSize);for(let i=0;i<count;i++){const blob=file.slice(i*chunkSize,Math.min(file.size,(i+1)*chunkSize));let result=null,last=null;for(let n=1;n<=3;n++){try{if(progress)progress.textContent="Uploading / 正在上传 "+file.name+" "+Math.round((i+1)/count*100)+"% ("+(i+1)+"/"+count+")";const r=await fetch("/api/files/multipart/"+encodeURIComponent(id)+"/part?partNumber="+(i+1),{method:"PUT",credentials:"same-origin",cache:"no-store",headers:{"X-CSRF-Token":session?.csrf||"","Content-Type":"application/octet-stream","X-Part-Size":String(blob.size)},body:blob});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||("HTTP "+r.status));result=d;break}catch(e){last=e}}if(!result)throw last||Error("Part upload failed");parts.push({partNumber:i+1,etag:result.etag})}',
'    if(progress)progress.textContent="Finalizing / 正在完成上传: "+file.name;await api("/api/files/multipart/"+encodeURIComponent(id)+"/complete",{method:"POST",body:{parts}});complete=true;done++',
'   }catch(e){failed.push(file.name+": "+(e.message||String(e)));if(id&&!complete)try{await api("/api/files/multipart/"+encodeURIComponent(id),{method:"DELETE",body:{}})}catch{}}',
'  }if(input)input.value="";await loadProductFiles(true);if(progress)progress.textContent=failed.length?"Uploaded "+done+"; failed "+failed.length:"Upload complete / 上传完成 "+done;if(failed.length)toast("Upload results / 上传结果：成功 "+done+"，失败 "+failed.length+"。"+failed.slice(0,2).join("；"));else toast("Upload complete / 上传完成："+done+" 个文件");',
' }'
].join("\n");
 a=a.slice(0,start)+replacement+a.slice(end);
 a=a.replace("Each file can be up to 20 MB; shared storage has a 9 GB safety cap.","Each file can be up to 10 GB; shared storage has a 20 GB safety cap.");
 a=a.replace("单个文件最大20MB，共享存储设有9GB安全上限。","单个文件最大10GB，共享存储设有20GB安全上限。");
 a=a.replace("productFileStorageLimit=9000000000","productFileStorageLimit=20000000000");
 const d='case "download":{const file=productFileRows.find(row=>row.id===id);const blob=await getProductFileBlob(id,true);downloadProductBlob(blob,file?.file_name||"product-file");break;}';
 if(a.includes(d))a=a.replace(d,'case "download":{const file=productFileRows.find(row=>row.id===id);const link=document.createElement("a");link.href="/api/files/"+encodeURIComponent(id)+"/content?download=1";link.download=file?.file_name||"product-file";link.rel="noopener";document.body.append(link);link.click();link.remove();break;}');
 a=a.replace("/* YOURZ PRODUCT FILE LIBRARY V1 HELPERS */","/* YOURZ PRODUCT FILE LIBRARY V1 HELPERS */\n /* YOURZ_R2_MULTIPART_10GB_V1 */");
 fs.writeFileSync(af,a);
}
const testFile=path.join(root,"test-worker.mjs");
let test=fs.readFileSync(testFile,"utf8");
test=test.replaceAll("9000000000","20000000000");
test=test.replace("constructor() { this.objects = new Map(); }","constructor() { this.objects = new Map(); this.multipartUploads = new Map(); }");
const deleteMock='  async delete(key) { this.objects.delete(key); }';
const multipartMock=[
'  async createMultipartUpload(key, options = {}) { const uploadId = "mock-upload-" + (this.multipartUploads.size + 1); this.multipartUploads.set(uploadId, { key, options, parts:new Map() }); return this.resumeMultipartUpload(key, uploadId); }',
'  resumeMultipartUpload(key, uploadId) {',
'    const state = this.multipartUploads.get(uploadId); if (!state || state.key !== key) throw new Error("Missing mock multipart upload");',
'    return {',
'      uploadPart: async (partNumber, body) => { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); state.parts.set(partNumber, bytes); return { etag:"etag-" + partNumber }; },',
'      complete: async (parts) => { const chunks = parts.map(part => state.parts.get(part.partNumber)); if (chunks.some(chunk => !chunk)) throw new Error("Missing mock part"); const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } this.objects.set(key, { bytes, options:state.options }); this.multipartUploads.delete(uploadId); },',
'      abort: async () => { this.multipartUploads.delete(uploadId); }',
'    };',
'  }'
].join("\n");
if(!test.includes("resumeMultipartUpload(")){
 if(!test.includes(deleteMock))throw new Error("R2 test mock anchor missing");
 test=test.replace(deleteMock,deleteMock+"\n"+multipartMock);
}
const quotaAnchor='const quotaDenied = await rawRequest("/api/files?name=quota.pdf"';
const multipartTests=[
'const multipartStart = await rawRequest("/api/files/multipart?name=" + encodeURIComponent("分片测试.pdf"), { method:"POST", body:samplePdf, cookie:adminCookie, csrf, contentLength:samplePdf.byteLength });',
'assert.equal(multipartStart.status,201, JSON.stringify(multipartStart.data));',
'const multipartId = multipartStart.data.uploadId;',
'const multipartPart = await rawRequest("/api/files/multipart/" + multipartId + "/part?partNumber=1", { method:"PUT", body:samplePdf, cookie:adminCookie, csrf, contentLength:samplePdf.byteLength });',
'assert.equal(multipartPart.status,200, JSON.stringify(multipartPart.data));',
'const multipartComplete = await request("/api/files/multipart/" + multipartId + "/complete", { method:"POST", body:{parts:[{partNumber:1,etag:"etag-1"}]}, cookie:adminCookie, csrf });',
'assert.equal(multipartComplete.status,201, await multipartComplete.clone().text());',
'const multipartFile = await multipartComplete.json();',
'assert.equal(multipartFile.file.file_name,"分片测试.pdf");',
'assert.deepEqual(Array.from(FILES.objects.values())[0].bytes,Array.from(samplePdf));',
'const multipartDelete = await request("/api/files/" + multipartId, { method:"DELETE", body:{}, cookie:adminCookie, csrf });',
'assert.equal(multipartDelete.status,200, await multipartDelete.clone().text());',
'assert.equal(FILES.objects.size,0);'
].join("\n");
if(!test.includes("const multipartStart =")) {
 if(!test.includes(quotaAnchor))throw new Error("Multipart test insertion anchor missing");
 test=test.replace(quotaAnchor,multipartTests+"\n"+quotaAnchor);
}
fs.writeFileSync(testFile,test);

if(!html.includes("multipart-10gb=20261025-1")){const m=html.match(/(<script\b[^>]*\bsrc=["'][^"']*app\.js\?)([^"']*)(["'][^>]*>)/i);if(!m)throw Error("Could not find versioned app.js URL");html=html.replace(m[0],m[1]+m[2]+"&multipart-10gb=20261025-1"+m[3]);fs.writeFileSync(ix,html)}
if(!h.includes("YOURZ_R2_MULTIPART_10GB_V1")||!a.includes("YOURZ_R2_MULTIPART_10GB_V1")||!html.includes("multipart-10gb=20261025-1"))throw Error("Multipart patch verification failed");
console.log("R2 multipart upload patch applied: 10 GB file cap, 20 GB shared cap, 16 MiB chunks, retries, CSRF/role checks, and streamed downloads.");
