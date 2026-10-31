import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || "app";
const handlerPath = path.join(root, "src/handler.js");
const appPath = path.join(root, "public/app.js");
let handler = fs.readFileSync(handlerPath, "utf8");
let app = fs.readFileSync(appPath, "utf8");

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error("Expected exactly one patch anchor for " + label + "; found " + count);
  return source.replace(before, after);
}

if (!handler.includes("YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1")) {
  const schema = 'await db.prepare("CREATE TABLE IF NOT EXISTS multipart_file_uploads (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL)").run();';
  const migrations = [
    schema,
    '  for (const sql of ["ALTER TABLE multipart_file_uploads ADD COLUMN supplier_id TEXT", "ALTER TABLE multipart_file_uploads ADD COLUMN file_category TEXT NOT NULL DEFAULT \'general\'"]) {',
    '    try { await db.prepare(sql).run(); } catch (error) { if (!/duplicate column name/i.test(String(error?.message || error))) throw error; }',
    '  }'
  ].join("\n");
  handler = replaceOnce(handler, schema, migrations, "supplier metadata migration for multipart uploads");

  const startFile = '    const fileName=productFileName(url.searchParams.get("name")||"");';
  const startFilePatch = [
    '    /* YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1 */',
    startFile,
    '    const supplierId=String(url.searchParams.get("supplierId")||"").trim();',
    '    const requestedCategory=String(url.searchParams.get("category")||"").trim();',
    '    const imageExtensions=["png","jpg","jpeg","webp"];',
    '    const category=supplierId?(requestedCategory||(imageExtensions.includes(fileName.split(".").pop().toLowerCase())?"image":"quote")):"general";',
    '    if(!["general","quote","image","other"].includes(category))fail(400,"File category is invalid / 文件分类无效");',
    '    if(supplierId){const supplier=await supplierQuoteOwner(env.DB,supplierId);if(!supplier||supplier.status==="deleted")fail(404,"Active supplier not found / 找不到有效供应商");}',
    '    if(category==="image"&&!imageExtensions.includes(fileName.split(".").pop().toLowerCase()))fail(415,"Product images must be PNG, JPG or WebP / 产品图片仅支持 PNG、JPG 或 WebP");',
    '    if(supplierId&&category==="quote"&&imageExtensions.includes(fileName.split(".").pop().toLowerCase()))fail(415,"Choose the Product image category for image files / 图片文件请选择“产品图片”分类");'
  ].join("\n");
  handler = replaceOnce(handler, startFile, startFilePatch, "read supplier association on multipart start");

  handler = replaceOnce(
    handler,
    'customMetadata:{fileId:id,uploadedBy:session.userId}',
    'customMetadata:{fileId:id,uploadedBy:session.userId,supplierId:supplierId||"",fileCategory:category}',
    "store supplier metadata on multipart R2 object"
  );
  handler = replaceOnce(
    handler,
    'INSERT INTO multipart_file_uploads(id,upload_id,object_key,file_name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
    'INSERT INTO multipart_file_uploads(id,upload_id,object_key,file_name,content_type,size,uploaded_by,created_at,supplier_id,file_category) VALUES(?,?,?,?,?,?,?,?,?,?)',
    "persist supplier metadata for multipart task"
  );
  handler = replaceOnce(
    handler,
    '.bind(id,multipart.uploadId,objectKey,fileName,contentType,size,session.userId,stamp()).run()',
    '.bind(id,multipart.uploadId,objectKey,fileName,contentType,size,session.userId,stamp(),supplierId||null,category).run()',
    "bind supplier metadata for multipart task"
  );
  handler = replaceOnce(
    handler,
    'SELECT id,upload_id,object_key,file_name,content_type,size,uploaded_by FROM multipart_file_uploads WHERE id=?',
    'SELECT id,upload_id,object_key,file_name,content_type,size,uploaded_by,supplier_id,file_category FROM multipart_file_uploads WHERE id=?',
    "read supplier metadata at multipart completion"
  );
  handler = replaceOnce(
    handler,
    'INSERT INTO uploaded_files(id,file_name,content_type,size,object_key,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)',
    'INSERT INTO uploaded_files(id,file_name,content_type,size,object_key,uploaded_by,uploaded_at,supplier_id,file_category) VALUES(?,?,?,?,?,?,?,?,?)',
    "save supplier association on completed file"
  );
  handler = replaceOnce(
    handler,
    '.bind(row.id,row.file_name,row.content_type,row.size,row.object_key,row.uploaded_by,at)',
    '.bind(row.id,row.file_name,row.content_type,row.size,row.object_key,row.uploaded_by,at,row.supplier_id||null,row.file_category||"general")',
    "bind supplier association on completed file"
  );
  handler = replaceOnce(
    handler,
    'uploaded_at:at}})}catch(error){fail(502,"Could not finalize upload; retry or contact admin / 无法完成上传，请重试或联系管理员")}',
    'uploaded_at:at,supplier_id:row.supplier_id||null,file_category:row.file_category||"general"}})}catch(error){fail(502,"Could not finalize upload; retry or contact admin / 无法完成上传，请重试或联系管理员")}',
    "return supplier association after completion"
  );
  fs.writeFileSync(handlerPath, handler);
}

if (!app.includes("YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1")) {
  const start = app.indexOf(" async function uploadSupplierQuoteFiles(id,files,category){");
  const end = app.indexOf("\n function guide(){", start);
  if (start < 0 || end < 0 || end <= start) throw new Error("Supplier upload UI function anchors missing.");
  const replacement = [
    ' /* YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1 */',
    ' async function uploadSupplierQuoteFiles(id,files,category){',
    '  if(!canEdit())throw Error("Ask your administrator for upload access / 请联系管理员开通上传权限");',
    '  if(stale||busy)throw Error("Load latest factory records and finish saving before uploading / 请先载入最新工厂资料并等待保存完成");',
    '  const supplier=get(id);if(!supplier||supplier.status==="deleted")throw Error("This supplier is deleted / 当前供应商已删除");',
    '  const progress=document.getElementById("supplierQuoteProgress");let done=0;const failed=[],chunkSize=16*1024*1024;',
    '  if(progress)progress.textContent="Preparing / 准备上传 "+files.length+" file(s)…";',
    '  for(const file of files){',
    '   if(!file.size){failed.push(file.name+": empty / 文件为空");continue;}',
    '   const ext=productExt(file.name);if(category==="image"&&!["png","jpg","jpeg","webp"].includes(ext)){failed.push(file.name+": use PNG, JPG or WebP for product images / 产品图片请使用 PNG、JPG 或 WebP");continue;}',
    '   if(category==="quote"&&["png","jpg","jpeg","webp"].includes(ext)){failed.push(file.name+": select Product image category / 图片文件请选择“产品图片”分类");continue;}',
    '   let uploadId="",complete=false;',
    '   try{',
    '    if(progress)progress.textContent="Starting / 正在创建任务: "+file.name;',
    '    const startUrl="/api/files/multipart?name="+encodeURIComponent(file.name)+"&supplierId="+encodeURIComponent(id)+"&category="+encodeURIComponent(category);',
    '    const startResponse=await fetch(startUrl,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"X-CSRF-Token":session?.csrf||"","X-File-Size":String(file.size)}});',
    '    let startData={};try{startData=await startResponse.json();}catch{}if(!startResponse.ok)throw Error(startData.error||("HTTP "+startResponse.status));',
    '    uploadId=startData.uploadId;if(!uploadId)throw Error("No upload session / 未取得上传任务编号");',
    '    const parts=[],count=Math.ceil(file.size/chunkSize);',
    '    for(let i=0;i<count;i++){',
    '     const blob=file.slice(i*chunkSize,Math.min(file.size,(i+1)*chunkSize));let result=null,lastError=null;',
    '     for(let attempt=1;attempt<=3;attempt++){try{',
    '      if(progress)progress.textContent="Uploading / 正在上传 "+file.name+" "+Math.round((i+1)/count*100)+"% ("+(i+1)+"/"+count+")";',
    '      const response=await fetch("/api/files/multipart/"+encodeURIComponent(uploadId)+"/part?partNumber="+(i+1),{method:"PUT",credentials:"same-origin",cache:"no-store",headers:{"X-CSRF-Token":session?.csrf||"","Content-Type":"application/octet-stream","X-Part-Size":String(blob.size)},body:await blob.arrayBuffer()});',
    '      let data={};try{data=await response.json();}catch{}if(!response.ok)throw Error(data.error||("HTTP "+response.status));result=data;break;',
    '     }catch(error){lastError=error;}}',
    '     if(!result)throw lastError||Error("Part upload failed / 分片上传失败");parts.push({partNumber:i+1,etag:result.etag});',
    '    }',
    '    if(progress)progress.textContent="Finalizing / 正在完成上传: "+file.name;',
    '    await api("/api/files/multipart/"+encodeURIComponent(uploadId)+"/complete",{method:"POST",body:{parts}});complete=true;done++;',
    '   }catch(error){failed.push(file.name+": "+(error.message||String(error)));if(uploadId&&!complete)try{await api("/api/files/multipart/"+encodeURIComponent(uploadId),{method:"DELETE",body:{}})}catch{}}',
    '  }',
    '  await loadSupplierQuoteFiles(id,true);if(progress)progress.textContent=failed.length?"Uploaded / 已上传 "+done+"; failed / 失败 "+failed.length:"Upload complete / 上传完成 "+done+" file(s)";',
    '  if(failed.length)toast("Upload results / 上传结果：成功 "+done+"，失败 "+failed.length+"。"+failed.slice(0,2).join("；"));else toast("Upload complete / 上传完成："+done+" 个文件");',
    ' }',
    ''
  ].join("\n");
  app = app.slice(0, start) + replacement + app.slice(end);
  fs.writeFileSync(appPath, app);
}

if (handler.includes("file.size>20*1024*1024") || app.includes("file.size>20*1024*1024") || !app.includes("YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1") || !handler.includes("YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1")) {
  throw new Error("Supplier multipart upload verification failed.");
}
console.log("Supplier quote uploads now use 16 MiB R2 multipart chunks; supplier linkage and 20 GB shared quota are preserved.");
