import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'app';
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const replaceOnce = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error('Patch target missing: ' + label);
  return source.replace(before, after);
};

/*
 * This patch is only applied by the test-branch validation workflow.
 * It adds supplier-linked file ownership to the existing private R2/D1 file library.
 */
let handler = read('src/handler.js');
if (!handler.includes('YOURZ_SUPPLIER_QUOTE_ARCHIVE_API_V1')) {
  const routeAnchor = 'async function handleProductFiles(request, env, session, url, route, method) {';
  const routePatch = [
    '/* YOURZ_SUPPLIER_QUOTE_ARCHIVE_API_V1 */',
    'let supplierQuoteColumnsReady = false;',
    'async function ensureSupplierQuoteColumns(db) {',
    '  if (supplierQuoteColumnsReady) return;',
    '  const addColumn = async sql => { try { await db.prepare(sql).run(); } catch (error) { if (!/duplicate column name/i.test(String(error?.message || error))) throw error; } };',
    '  await addColumn("ALTER TABLE uploaded_files ADD COLUMN supplier_id TEXT");',
    '  await addColumn("ALTER TABLE uploaded_files ADD COLUMN file_category TEXT NOT NULL DEFAULT \'general\'");',
    "  await db.prepare('CREATE INDEX IF NOT EXISTS idx_uploaded_files_supplier_id ON uploaded_files(supplier_id, uploaded_at DESC)').run();",
    '  supplierQuoteColumnsReady = true;',
    '}',
    'async function supplierQuoteOwner(db, id) {',
    '  if (!id) return null;',
    '  const state = await readState(db);',
    '  return (state.factories || []).find(factory => String(factory.id) === String(id)) || null;',
    '}',
    routeAnchor,
    '  await ensureSupplierQuoteColumns(env.DB);'
  ].join('\n');
  handler = replaceOnce(handler, routeAnchor, routePatch, 'supplier-linked file schema migration helper');

  const listOld = [
    "    const count = await env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(size),0) AS total_bytes FROM uploaded_files').first();",
    "    const result = await env.DB.prepare('SELECT id,file_name,content_type,size,uploaded_by,uploaded_at FROM uploaded_files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?').bind(pageSize, (page - 1) * pageSize).all();",
    '    return jsonResponse(request, 200, { files:result.results || [], total:Number(count?.total || 0), totalBytes:Number(count?.total_bytes || 0), storageLimitBytes:MAX_TOTAL_PRODUCT_FILE_BYTES, page, pageSize });'
  ].join('\n');
  const listNew = [
    '    const supplierId = String(url.searchParams.get("supplierId") || "").trim();',
    "    if (supplierId && !(await supplierQuoteOwner(env.DB, supplierId))) fail(404, 'Supplier not found / 供应商不存在');",
    '    const count = supplierId',
    "      ? await env.DB.prepare('SELECT COUNT(*) AS total FROM uploaded_files WHERE supplier_id=?').bind(supplierId).first()",
    "      : await env.DB.prepare('SELECT COUNT(*) AS total FROM uploaded_files WHERE supplier_id IS NULL').first();",
    "    const usage = await env.DB.prepare('SELECT COALESCE(SUM(size),0) AS total_bytes FROM uploaded_files').first();",
    '    const result = supplierId',
    "      ? await env.DB.prepare('SELECT id,file_name,content_type,size,uploaded_by,uploaded_at,supplier_id,file_category FROM uploaded_files WHERE supplier_id=? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?').bind(supplierId, pageSize, (page - 1) * pageSize).all()",
    "      : await env.DB.prepare('SELECT id,file_name,content_type,size,uploaded_by,uploaded_at,supplier_id,file_category FROM uploaded_files WHERE supplier_id IS NULL ORDER BY uploaded_at DESC LIMIT ? OFFSET ?').bind(pageSize, (page - 1) * pageSize).all();",
    '    return jsonResponse(request, 200, { files:result.results || [], total:Number(count?.total || 0), totalBytes:Number(usage?.total_bytes || 0), storageLimitBytes:MAX_TOTAL_PRODUCT_FILE_BYTES, page, pageSize });'
  ].join('\n');
  handler = replaceOnce(handler, listOld, listNew, 'scope file listing to a supplier or the general library');

  const contentTypeAnchor = '    const contentType = PRODUCT_FILE_MIME[extension];';
  const contentTypePatch = [
    contentTypeAnchor,
    '    const supplierId = String(url.searchParams.get("supplierId") || "").trim();',
    '    const requestedCategory = String(url.searchParams.get("category") || "").trim();',
    '    const imageExtensions = ["png","jpg","jpeg","webp"];',
    '    const category = supplierId ? (requestedCategory || (imageExtensions.includes(extension) ? "image" : "quote")) : "general";',
    '    if (!["general","quote","image","other"].includes(category)) fail(400, "File category is invalid / 文件分类无效");',
    '    if (supplierId) {',
    '      const supplier = await supplierQuoteOwner(env.DB, supplierId);',
    '      if (!supplier || supplier.status === "deleted") fail(404, "Active supplier not found / 找不到有效供应商");',
    '    }',
    '    if (category === "image" && !imageExtensions.includes(extension)) fail(415, "Product images must be PNG, JPG or WebP / 产品图片仅支持 PNG、JPG 或 WebP");',
    '    if (supplierId && category === "quote" && imageExtensions.includes(extension)) fail(415, "Choose the Product image category for image files / 图片文件请选择“产品图片”分类");'
  ].join('\n');
  handler = replaceOnce(handler, contentTypeAnchor, contentTypePatch, 'validate supplier, quote and image uploads');

  handler = replaceOnce(
    handler,
    "      const uploadPromise = env.FILES.put(objectKey, fixedBody.readable, { httpMetadata:{ contentType }, customMetadata:{ fileId:id, uploadedBy:session.userId } });",
    "      const uploadPromise = env.FILES.put(objectKey, fixedBody.readable, { httpMetadata:{ contentType }, customMetadata:{ fileId:id, uploadedBy:session.userId, supplierId:supplierId || '', fileCategory:category } });",
    'store supplier metadata on the private R2 object'
  );

  handler = replaceOnce(
    handler,
    "        env.DB.prepare('INSERT INTO uploaded_files(id,file_name,content_type,size,object_key,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)').bind(id, fileName, contentType, size, objectKey, session.userId, uploadedAt),",
    "        env.DB.prepare('INSERT INTO uploaded_files(id,file_name,content_type,size,object_key,uploaded_by,uploaded_at,supplier_id,file_category) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, fileName, contentType, size, objectKey, session.userId, uploadedAt, supplierId || null, category),",
    'save supplier ID and category with the file metadata'
  );

  handler = replaceOnce(
    handler,
    "    return jsonResponse(request, 201, { ok:true, file:{ id, file_name:fileName, content_type:contentType, size, uploaded_by:session.userId, uploaded_at:uploadedAt } });",
    "    return jsonResponse(request, 201, { ok:true, file:{ id, file_name:fileName, content_type:contentType, size, uploaded_by:session.userId, uploaded_at:uploadedAt, supplier_id:supplierId || null, file_category:category } });",
    'return the saved supplier linkage'
  );

  handler = replaceOnce(
    handler,
    "    const meta = await env.DB.prepare('SELECT id,file_name,content_type,size,object_key FROM uploaded_files WHERE id=?').bind(contentMatch[1]).first();\n    if (!meta) fail(404, 'File not found / 文件不存在');",
    "    const meta = await env.DB.prepare('SELECT id,file_name,content_type,size,object_key,supplier_id,file_category FROM uploaded_files WHERE id=?').bind(contentMatch[1]).first();\n    if (!meta) fail(404, 'File not found / 文件不存在');\n    const requestedSupplierId = url.searchParams.get('supplierId');\n    if (meta.supplier_id && (requestedSupplierId === null || String(meta.supplier_id) !== requestedSupplierId)) fail(404, 'File not found for this supplier / 该供应商下没有此文件');\n    if (requestedSupplierId !== null && String(meta.supplier_id || '') !== requestedSupplierId) fail(404, 'File not found for this supplier / 该供应商下没有此文件');",
    'validate the supplier association for file preview and download'
  );

  handler = replaceOnce(
    handler,
    "    const meta = await env.DB.prepare('SELECT id,file_name,object_key FROM uploaded_files WHERE id=?').bind(deleteMatch[1]).first();\n    if (!meta) fail(404, 'File not found / 文件不存在');",
    "    const meta = await env.DB.prepare('SELECT id,file_name,object_key,supplier_id FROM uploaded_files WHERE id=?').bind(deleteMatch[1]).first();\n    if (!meta) fail(404, 'File not found / 文件不存在');\n    const requestedSupplierId = url.searchParams.get('supplierId');\n    if (requestedSupplierId !== null && String(meta.supplier_id || '') !== requestedSupplierId) fail(404, 'File not found for this supplier / 该供应商下没有此文件');\n    if (requestedSupplierId === null && meta.supplier_id) fail(404, 'Use the supplier profile to manage this file / 请在对应供应商档案中管理此文件');",
    'prevent deleting supplier-linked files from the general library route'
  );
  write('src/handler.js', handler);
  console.log('Supplier file API added: D1 linkage, scoped listing, upload categories, and supplier-checked preview/download/delete.');
}

let app = read('public/app.js');
if (!app.includes('YOURZ_SUPPLIER_QUOTE_ARCHIVE_V1')) {
  const stateAnchor = "let productFileRows=[],productFileTotal=0,productFilePage=1,productFilePageSize=50,productFilesLoading=false,activeProductPreviewUrl='',productFileTotalBytes=0,productFileStorageLimit=9000000000;";
  const statePatch = stateAnchor + "\n /* YOURZ_SUPPLIER_QUOTE_ARCHIVE_V1 */\n let supplierQuoteRows=[],supplierQuoteTotal=0,supplierQuotePage=1,supplierQuotePageSize=50,supplierQuoteLoading=false,supplierQuoteLoadingId='',supplierQuoteSupplierId='',supplierQuoteLoadNeeded=true;";
  app = replaceOnce(app, stateAnchor, statePatch, 'supplier quote UI state');

  const renderAnchor = "main.innerHTML=banner()+content;if(view==='guide'){renderProductFiles();bindProductFileInput();if(!productFilesLoading)loadProductFiles(true).catch(()=>{});}const search=document.getElementById('search');if(search)";
  const renderPatch = "main.innerHTML=banner()+content;if(selected){mountSupplierQuoteFiles(selected);}if(view==='guide'){renderProductFiles();bindProductFileInput();if(!productFilesLoading)loadProductFiles(true).catch(()=>{});}const search=document.getElementById('search');if(search)";
  app = replaceOnce(app, renderAnchor, renderPatch, 'mount supplier-specific files inside the supplier profile');

  const blobAnchor = ' async function getProductFileBlob(id,download){const url="/api/files/"+encodeURIComponent(id)+"/content"+(download?"?download=1":"");const response=await fetch(url,{credentials:"same-origin",cache:"no-store"});if(!response.ok){let data={};try{data=await response.json();}catch{}throw Error(data.error||("HTTP "+response.status));}return response.blob();}';
  const blobPatch = ' async function getProductFileBlob(id,download,supplierId=""){const params=new URLSearchParams();if(supplierId)params.set("supplierId",supplierId);if(download)params.set("download","1");const query=params.toString();const url="/api/files/"+encodeURIComponent(id)+"/content"+(query?"?"+query:"");const response=await fetch(url,{credentials:"same-origin",cache:"no-store"});if(!response.ok){let data={};try{data=await response.json();}catch{}throw Error(data.error||("HTTP "+response.status));}return response.blob();}';
  app = replaceOnce(app, blobAnchor, blobPatch, 'allow supplier-scoped private file reads');

  const previewAnchor = ' async function previewProductFile(id){const file=productFileRows.find(row=>row.id===id);if(!file)throw Error("Reload the file list and retry / 请刷新文件列表后重试");const blob=await getProductFileBlob(id,false);';
  const previewPatch = ' async function previewProductFile(id,collection=productFileRows,supplierId=""){const file=collection.find(row=>row.id===id);if(!file)throw Error("Reload the file list and retry / 请刷新文件列表后重试");const blob=await getProductFileBlob(id,false,supplierId);';
  app = replaceOnce(app, previewAnchor, previewPatch, 'reuse the existing full preview for supplier quote files');

  const helperAnchor = ' function guide(){';
  const helperSource = [
    ' /* YOURZ SUPPLIER QUOTE ARCHIVE V1 HELPERS */',
    ' function supplierQuotePanel(id){',
    '  const f=get(id);if(!f)return "";',
    '  const canUpload=canEdit()&&f.status!=="deleted";',
    '  return \'<section class="panel supplier-quote-panel" data-supplier-quote-root data-supplier-id="\'+esc(id)+\'"><div class="heading"><div><h2>Supplier quotes & product images / 供应商报价单与产品图片</h2><p class="sub">Files uploaded here belong to this supplier only / 在此上传的文件只归属于当前供应商</p></div></div>\'+',
    '    (canUpload?\'<div class="supplier-quote-toolbar"><label class="field"><span>File type / 文件用途</span><select id="supplierQuoteCategory"><option value="quote">Quotation / 报价单</option><option value="image">Product image / 产品图片</option><option value="other">Other document / 其他资料</option></select></label><label class="small supplier-quote-pick" for="supplierQuoteInput">Choose files / 选择文件</label><input id="supplierQuoteInput" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.webp"><span id="supplierQuoteProgress" class="sub" role="status"></span></div>\':\'<p class="notice">View only / 仅查看：如需上传文件，请联系管理员开通编辑权限。</p>\')+',
    '    \'<p class="sub">Supplier / 供应商：<strong>\'+esc(f.name)+\'</strong> · ID: \'+esc(id)+\'</p><div id="supplierQuoteList"><p class="sub">Loading supplier files / 正在载入该供应商文件…</p></div></section>\';',
    ' }',
    ' function renderSupplierQuoteList(id){',
    '  const box=document.getElementById("supplierQuoteList");if(!box||supplierQuoteSupplierId!==id)return;',
    '  if(!supplierQuoteRows.length){box.innerHTML=\'<div class="empty"><h3>No supplier files yet / 暂无该供应商文件</h3><p>Upload a quotation or product photo above. / 可在上方上传报价单或产品图片。</p></div>\';return;}',
    '  const cards=supplierQuoteRows.map(f=>{const ext=productExt(f.file_name);const image=f.file_category==="image"||["png","jpg","jpeg","webp"].includes(ext);const imageUrl="/api/files/"+encodeURIComponent(f.id)+"/content?supplierId="+encodeURIComponent(id);const visual=image?\'<button class="supplier-quote-thumb-button" type="button" data-sq-act="preview" data-sq-id="\'+esc(f.id)+\'"><img class="supplier-quote-thumb" alt="\'+esc(f.file_name)+\'" loading="lazy" src="\'+imageUrl+\'"></button>\':\'<button class="supplier-quote-doc-icon" type="button" data-sq-act="preview" data-sq-id="\'+esc(f.id)+\'">\'+esc(ext.toUpperCase()||"FILE")+\'</button>\';const category=f.file_category==="image"?"Product image / 产品图片":f.file_category==="quote"?"Quotation / 报价单":f.file_category==="other"?"Other document / 其他资料":"File / 文件";return \'<article class="supplier-quote-card">\'+visual+\'<div class="supplier-quote-card-body"><span class="supplier-quote-category">\'+category+\'</span><strong class="supplier-quote-name">\'+esc(f.file_name)+\'</strong><span class="sub">\'+productSize(f.size)+\' · \'+esc(f.uploaded_by||"")+\'</span><span class="sub">\'+esc(String(f.uploaded_at||"").replace("T"," ").replace(/\\\\.\\\\d+Z$/," UTC"))+\'</span><div class="actions"><button class="small" type="button" data-sq-act="preview" data-sq-id="\'+esc(f.id)+\'">Preview / 预览</button><button class="small" type="button" data-sq-act="download" data-sq-id="\'+esc(f.id)+\'">Download / 下载</button>\'+(canEdit()?\'<button class="small danger" type="button" data-sq-act="delete" data-sq-id="\'+esc(f.id)+\'">Delete / 删除</button>\':\'\')+\'</div></div></article>\';}).join("");',
    '  box.innerHTML=\'<div class="supplier-quote-grid">\'+cards+\'</div>\'+(supplierQuoteTotal>supplierQuotePageSize?\'<div class="actions supplier-quote-pagination"><button class="small" data-sq-act="prev" type="button" \'+(supplierQuotePage<=1?"disabled":"")+\'>Previous / 上一页</button><span class="sub">Page / 页 \'+supplierQuotePage+\' · \'+supplierQuoteTotal+\' files / 个文件</span><button class="small" data-sq-act="next" type="button" \'+(supplierQuotePage*supplierQuotePageSize>=supplierQuoteTotal?"disabled":"")+\'>Next / 下一页</button></div>\':\'<p class="sub">\'+supplierQuoteRows.length+\' files / 个文件</p>\');',
    ' }',
    ' async function loadSupplierQuoteFiles(id,silent=true){',
    '  if(supplierQuoteLoading&&supplierQuoteLoadingId===id)return;',
    '  supplierQuoteLoading=true;supplierQuoteLoadingId=id;',
    '  try{const data=await api("/api/files?supplierId="+encodeURIComponent(id)+"&page="+supplierQuotePage);if(selected!==id)return;supplierQuoteRows=data.files||[];supplierQuoteTotal=Number(data.total)||0;supplierQuotePage=Number(data.page)||1;supplierQuotePageSize=Number(data.pageSize)||50;renderSupplierQuoteList(id);}',
    '  catch(error){const box=document.getElementById("supplierQuoteList");if(box&&selected===id)box.innerHTML=\'<p class="notice error">\'+esc(error.message||String(error))+\'</p>\';if(!silent)toast(error.message||String(error));}',
    '  finally{if(supplierQuoteLoadingId===id){supplierQuoteLoading=false;supplierQuoteLoadingId="";}if(selected&&selected!==id&&supplierQuoteSupplierId!==selected)loadSupplierQuoteFiles(selected,true).catch(()=>{});}',
    ' }',
    ' function mountSupplierQuoteFiles(id){',
    '  const f=get(id);if(!f)return;',
    '  if(supplierQuoteSupplierId!==id){supplierQuoteSupplierId=id;supplierQuoteRows=[];supplierQuoteTotal=0;supplierQuotePage=1;supplierQuoteLoadNeeded=true;}',
    '  main.insertAdjacentHTML("beforeend",supplierQuotePanel(id));',
    '  const root=main.querySelector("[data-supplier-quote-root]");if(!root)return;',
    '  const input=root.querySelector("#supplierQuoteInput");if(input)input.onchange=async event=>{const files=Array.from(event.target.files||[]);event.target.value="";if(!files.length)return;const category=root.querySelector("#supplierQuoteCategory")?.value||"quote";await uploadSupplierQuoteFiles(id,files,category);};',
    '  root.onclick=async event=>{const button=event.target.closest("[data-sq-act]");if(!button)return;const action=button.dataset.sqAct,fileId=button.dataset.sqId;if(action==="prev"){supplierQuotePage=Math.max(1,supplierQuotePage-1);await loadSupplierQuoteFiles(id,false);return;}if(action==="next"){if(supplierQuotePage*supplierQuotePageSize<supplierQuoteTotal){supplierQuotePage++;await loadSupplierQuoteFiles(id,false);}return;}try{const file=supplierQuoteRows.find(row=>row.id===fileId);if(!file)throw Error("Reload supplier files and retry / 请重新载入供应商文件");if(action==="preview"){await previewProductFile(fileId,supplierQuoteRows,id);}else if(action==="download"){const blob=await getProductFileBlob(fileId,true,id);downloadProductBlob(blob,file.file_name);}else if(action==="delete"){if(!canEdit())throw Error("Ask your administrator for edit access / 请联系管理员开通编辑权限");if(!confirm("Delete this file from "+(get(id)?.name||"this supplier")+"? Other suppliers and factory records will not be changed. / 确认从当前供应商中删除此文件？不会修改其他供应商及工厂资料。"))return;const response=await fetch("/api/files/"+encodeURIComponent(fileId)+"?supplierId="+encodeURIComponent(id),{method:"DELETE",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":session?.csrf||""},body:"{}"});let data={};try{data=await response.json();}catch{}if(!response.ok)throw Error(data.error||("HTTP "+response.status));await loadSupplierQuoteFiles(id,true);toast("File deleted / 文件已删除");}}catch(error){toast(error.message||String(error));}};',
    '  if(supplierQuoteLoadNeeded){supplierQuoteLoadNeeded=false;loadSupplierQuoteFiles(id,true).catch(()=>{});}else renderSupplierQuoteList(id);',
    ' }',
    ' async function uploadSupplierQuoteFiles(id,files,category){',
    '  if(!canEdit())throw Error("Ask your administrator for upload access / 请联系管理员开通上传权限");',
    '  if(stale||busy)throw Error("Load latest factory records and finish saving before uploading / 请先载入最新工厂资料并等待保存完成");',
    '  const supplier=get(id);if(!supplier||supplier.status==="deleted")throw Error("This supplier is deleted / 当前供应商已删除");',
    '  const progress=document.getElementById("supplierQuoteProgress");let done=0;const failed=[];',
    '  if(progress)progress.textContent="Preparing / 准备上传 "+files.length+" file(s)…";',
    '  for(const file of files){if(!file.size){failed.push(file.name+": empty / 文件为空");continue;}if(file.size>20*1024*1024){failed.push(file.name+": exceeds 20 MB / 超过20MB");continue;}if(category==="image"&&!["png","jpg","jpeg","webp"].includes(productExt(file.name))){failed.push(file.name+": use PNG, JPG or WebP for product images / 产品图片请使用 PNG、JPG 或 WebP");continue;}if(category==="quote"&&["png","jpg","jpeg","webp"].includes(productExt(file.name))){failed.push(file.name+": select Product image category / 图片文件请选择“产品图片”分类");continue;}if(progress)progress.textContent="Uploading / 正在上传 "+(done+1)+"/"+files.length+": "+file.name;',
    '   try{const url="/api/files?name="+encodeURIComponent(file.name)+"&supplierId="+encodeURIComponent(id)+"&category="+encodeURIComponent(category);const response=await fetch(url,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"X-CSRF-Token":session?.csrf||"","Content-Type":file.type||"application/octet-stream","X-File-Size":String(file.size)},body:file});let data={};try{data=await response.json();}catch{}if(!response.ok)throw Error(data.error||("HTTP "+response.status));done++;}catch(error){failed.push(file.name+": "+(error.message||String(error)));}}',
    '  await loadSupplierQuoteFiles(id,true);if(progress)progress.textContent=failed.length?"Uploaded / 已上传 "+done+"; failed / 失败 "+failed.length:"Upload complete / 上传完成 "+done+" file(s)";',
    '  if(failed.length)toast("Upload results / 上传结果：成功 "+done+"，失败 "+failed.length+"。"+failed.slice(0,2).join("；"));else toast("Upload complete / 上传完成："+done+" 个文件");',
    ' }',
    ''
  ].join('\n');
  app = replaceOnce(app, helperAnchor, helperSource + '\n' + helperAnchor, 'supplier quote panel, image thumbnails and actions');

  let css = read('public/style.css');
  if (!css.includes('YOURZ SUPPLIER QUOTE ARCHIVE V1 STYLES')) {
    css += '\n\n/* YOURZ SUPPLIER QUOTE ARCHIVE V1 STYLES */\n.supplier-quote-panel{margin-top:18px}.supplier-quote-toolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:12px 0 18px}.supplier-quote-toolbar .field{min-width:190px;max-width:280px;margin:0}.supplier-quote-pick{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 14px;border:1px solid #cbd9e8;border-radius:8px;cursor:pointer;background:#f3f8fc;color:#164c7b}.supplier-quote-toolbar input[type=file]{max-width:100%}.supplier-quote-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}.supplier-quote-card{min-width:0;border:1px solid #dbe5ef;border-radius:12px;overflow:hidden;background:#fff;display:flex;flex-direction:column}.supplier-quote-thumb-button{display:block;width:100%;padding:0;border:0;border-radius:0;background:#f5f8fc;cursor:pointer}.supplier-quote-thumb{display:block;width:100%;height:170px;object-fit:contain}.supplier-quote-doc-icon{display:flex;align-items:center;justify-content:center;height:170px;width:100%;border:0;border-radius:0;background:#f5f8fc;color:#2b628e;font-weight:700;font-size:24px;cursor:pointer}.supplier-quote-card-body{display:flex;flex-direction:column;gap:7px;padding:12px;min-width:0}.supplier-quote-category{font-size:12px;color:#426b8d}.supplier-quote-name{overflow-wrap:anywhere;line-height:1.4}.supplier-quote-card .actions{margin-top:5px;display:flex;flex-wrap:wrap;gap:6px}.supplier-quote-pagination{margin-top:12px}\n';
    write('public/style.css', css);
  }

  write('public/app.js', app);
}

let html = read('public/index.html');
const scriptRef = /(<script\b[^>]*\bsrc=["'])([^"']*app\.js)(?:\?[^"']*)?(["'][^>]*>)/i;
const match = html.match(scriptRef);
if (!match) throw new Error('Could not find the app.js reference in index.html; refusing a potentially cached UI.');
const version = 'v=yourz-refresh-20261020-1&supplier-quotes=20261020-1';
html = html.replace(scriptRef, match[1] + match[2] + '?' + version + match[3]);
write('public/index.html', html);
console.log('Browser cache-busting updated for supplier quote and product-image previews.');

let test = read('test-worker.mjs');
if (!test.includes('YOURZ_SUPPLIER_QUOTE_ARCHIVE_TESTS_V1')) {
  const testAnchor = "console.log('PASS: public entry, shared D1 state, record save, conflict protection, backup, and automatic re-entry.');";
  const testPatch = [
    '/* YOURZ_SUPPLIER_QUOTE_ARCHIVE_TESTS_V1 */',
    "const supplierStateResponse = await request('/api/state');",
    'assert.equal(supplierStateResponse.status,200);',
    'const supplierStateData = await supplierStateResponse.json();',
    'const supplierCookie = (supplierStateResponse.headers.get("set-cookie")||"").match(/__Host-factory-session=[^;]+/)?.[0]||"";',
    'assert.ok(supplierCookie,"The isolated public-entry session must issue its own cookie.");',
    'assert.equal(supplierStateData.session.role,"editor");',
    "const supplierCreateResponse = await request('/api/action',{method:'POST',body:{baseRevision:supplierStateData.state.revision,type:'factory.save',data:{name:'ZZ_SUPPLIER_QUOTE_TEST_A',products:'test quote archive',city:'test',business:'factory',lead:'days7'}},cookie:supplierCookie,csrf:supplierStateData.session.csrf});",
    'assert.equal(supplierCreateResponse.status,200,await supplierCreateResponse.clone().text());',
    'const supplierCreateData = await supplierCreateResponse.json();',
    "const supplierId = supplierCreateData.state.factories.find(f=>f.name==='ZZ_SUPPLIER_QUOTE_TEST_A')?.id;",
    'assert.ok(supplierId);',
    "const secondSupplierResponse = await request('/api/action',{method:'POST',body:{baseRevision:supplierCreateData.state.revision,type:'factory.save',data:{name:'ZZ_SUPPLIER_QUOTE_TEST_B',products:'isolated test supplier',city:'test',business:'factory',lead:'days7'}},cookie:supplierCookie,csrf:supplierCreateData.session.csrf});",
    'assert.equal(secondSupplierResponse.status,200,await secondSupplierResponse.clone().text());',
    "const secondSupplierId = (await secondSupplierResponse.json()).state.factories.find(f=>f.name==='ZZ_SUPPLIER_QUOTE_TEST_B')?.id;",
    'assert.ok(secondSupplierId);',
    'const sampleSupplierPdf = new Uint8Array([37,80,68,70,45,49,46,55,10,37,81,85,79,84,69,10]);',
    'const sampleProductPng = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,15,0,1,1,1,0,24,221,141,180,0,0,0,0,73,69,78,68,174,66,96,130]);',
    'const supplierQuoteUpload = await rawRequest("/api/files?name=供应商报价测试.pdf&supplierId="+encodeURIComponent(supplierId)+"&category=quote",{method:"POST",body:sampleSupplierPdf,cookie:supplierCookie,csrf:supplierCreateData.session.csrf,contentType:"application/pdf",contentLength:sampleSupplierPdf.byteLength});',
    'assert.equal(supplierQuoteUpload.status,201,JSON.stringify(supplierQuoteUpload.data));',
    'assert.equal(supplierQuoteUpload.data.file.supplier_id,supplierId);',
    'assert.equal(supplierQuoteUpload.data.file.file_category,"quote");',
    'const supplierImageUpload = await rawRequest("/api/files?name=产品图片测试.png&supplierId="+encodeURIComponent(supplierId)+"&category=image",{method:"POST",body:sampleProductPng,cookie:supplierCookie,csrf:supplierCreateData.session.csrf,contentType:"image/png",contentLength:sampleProductPng.byteLength});',
    'assert.equal(supplierImageUpload.status,201,JSON.stringify(supplierImageUpload.data));',
    'assert.equal(supplierImageUpload.data.file.supplier_id,supplierId);',
    'assert.equal(supplierImageUpload.data.file.file_category,"image");',
    'const supplierFileListResponse = await request("/api/files?supplierId="+encodeURIComponent(supplierId)+"&page=1",{cookie:supplierCookie});',
    'assert.equal(supplierFileListResponse.status,200,await supplierFileListResponse.clone().text());',
    'const supplierFileList = await supplierFileListResponse.json();',
    'assert.equal(supplierFileList.total,2);',
    'assert.ok(supplierFileList.files.every(f=>f.supplier_id===supplierId));',
    'assert.ok(supplierFileList.files.some(f=>f.file_category==="quote"));',
    'assert.ok(supplierFileList.files.some(f=>f.file_category==="image"));',
    'const otherSupplierList = await request("/api/files?supplierId="+encodeURIComponent(secondSupplierId)+"&page=1",{cookie:supplierCookie});',
    'assert.equal((await otherSupplierList.json()).total,0,"A supplier must not see another supplier’s files.");',
    'const generalFileList = await request("/api/files?page=1",{cookie:supplierCookie});',
    'assert.equal((await generalFileList.json()).total,0,"Supplier-linked files must not appear in the general library.");',
    'const imagePreview = await rawRequest("/api/files/"+encodeURIComponent(supplierImageUpload.data.file.id)+"/content?supplierId="+encodeURIComponent(supplierId),{cookie:supplierCookie});',
    'assert.equal(imagePreview.status,200,JSON.stringify(imagePreview.data));',
    'assert.match(imagePreview.response.headers.get("content-type")||"",/image\\/png/i);',
    'assert.deepEqual(Array.from(new Uint8Array(await imagePreview.response.arrayBuffer())),Array.from(sampleProductPng));',
    'const imageCrossSupplier = await request("/api/files/"+encodeURIComponent(supplierImageUpload.data.file.id)+"/content?supplierId="+encodeURIComponent(secondSupplierId),{cookie:supplierCookie});',
    'assert.equal(imageCrossSupplier.status,404);',
    'const imageWithoutSupplier = await request("/api/files/"+encodeURIComponent(supplierImageUpload.data.file.id)+"/content",{cookie:supplierCookie});',
    'assert.equal(imageWithoutSupplier.status,404,"Supplier-linked file content must require the owning supplier ID.");',
    'const imageWithBlankSupplier = await request("/api/files/"+encodeURIComponent(supplierImageUpload.data.file.id)+"/content?supplierId=",{cookie:supplierCookie});',
    'assert.equal(imageWithBlankSupplier.status,404,"A blank supplier ID must not bypass supplier ownership.");',
    'const crossSupplierDelete = await request("/api/files/"+encodeURIComponent(supplierImageUpload.data.file.id)+"?supplierId="+encodeURIComponent(secondSupplierId),{method:"DELETE",body:{},cookie:supplierCookie,csrf:supplierCreateData.session.csrf});',
    'assert.equal(crossSupplierDelete.status,404);',
    'const deleteQuote = await request("/api/files/"+encodeURIComponent(supplierQuoteUpload.data.file.id)+"?supplierId="+encodeURIComponent(supplierId),{method:"DELETE",body:{},cookie:supplierCookie,csrf:supplierCreateData.session.csrf});',
    'assert.equal(deleteQuote.status,200,await deleteQuote.clone().text());',
    'const deleteImage = await request("/api/files/"+encodeURIComponent(supplierImageUpload.data.file.id)+"?supplierId="+encodeURIComponent(supplierId),{method:"DELETE",body:{},cookie:supplierCookie,csrf:supplierCreateData.session.csrf});',
    'assert.equal(deleteImage.status,200,await deleteImage.clone().text());',
    'const supplierListAfterCleanup = await request("/api/files?supplierId="+encodeURIComponent(supplierId)+"&page=1",{cookie:supplierCookie});',
    'assert.equal((await supplierListAfterCleanup.json()).total,0);',
    'const supplierXlsxPreviewSource = await (await import("node:fs/promises")).readFile("public/app.js","utf8");',
    'assert.ok(supplierXlsxPreviewSource.includes("YOURZ_XLSX_INLINE_IMAGE_PREVIEW_V1"), "XLSX embedded-image preview patch must be applied.");',
    'assert.ok(supplierXlsxPreviewSource.includes("xlsx-cell-image"), "XLSX preview must render embedded product images.");',
    'assert.ok(supplierXlsxPreviewSource.includes("YOURZ_XLSX_URL_CLEANUP_V1"), "XLSX preview object URLs must be cleaned up.");',
    testAnchor
  ].join('\n');
  test = replaceOnce(test, testAnchor, testPatch, 'test supplier association, separate listings, inline image bytes and cross-supplier guards');
  write('test-worker.mjs', test);
}

console.log('Supplier quote archive patch applied for isolated testing only.');
await import('./add-xlsx-inline-image-preview.mjs');
