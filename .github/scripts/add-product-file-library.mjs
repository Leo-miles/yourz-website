import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'app';
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const replaceOnce = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error('Patch target missing: ' + label);
  return source.replace(before, after);
};

let handler = read('src/handler.js');
if (!handler.includes('YOURZ_PRODUCT_FILES_SCHEMA_V1')) {
  const schemaAnchor = '  const packed = await gzipText(JSON.stringify(C.blank()));';
  const schemaPatch = [
    '  /* YOURZ_PRODUCT_FILES_SCHEMA_V1 */',
    '  await db.prepare("CREATE TABLE IF NOT EXISTS uploaded_files (id TEXT PRIMARY KEY, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL)").run();',
    "  await db.prepare('CREATE INDEX IF NOT EXISTS idx_uploaded_files_uploaded_at ON uploaded_files(uploaded_at DESC)').run();",
    schemaAnchor
  ].join('\n');
  handler = replaceOnce(handler, schemaAnchor, schemaPatch, 'D1 product-file metadata schema');

  const helperAnchor = "let configuredTimeZone = 'Asia/Shanghai';";
  const helperPatch = [
    '/* YOURZ PRODUCT FILE LIBRARY V1 */',
    'const PRODUCT_FILE_MIME = {',
    "  pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',",
    "  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',",
    "  ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',",
    "  csv:'text/csv; charset=utf-8', txt:'text/plain; charset=utf-8', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp'",
    '};',
    'const MAX_PRODUCT_FILE_BYTES = 20 * 1024 * 1024;',
    'function productFileName(value) {',
    "  let name = text(value, 500).replace(/[\\\\/]/g, '/').split('/').pop().trim();",
    "  name = name.replace(/[\\u0000-\\u001f\\u007f]/g, '').slice(0, 220);",
    "  if (!name || name === '.' || name === '..') fail(400, 'File name is invalid / 文件名无效');",
    '  return name;',
    '}',
    'function productFileWriteGuard(request, session) {',
    "  if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');",
    "  if (!['admin','editor'].includes(session.role)) fail(403, 'You do not have permission to upload or delete files / 您没有上传或删除文件的权限');",
    '  requireOrigin(request);',
    "  if (request.headers.get('X-CSRF-Token') !== session.csrf) fail(403, 'Request could not be verified; refresh the app / 无法验证请求，请刷新应用');",
    '}',
    'async function handleProductFiles(request, env, session, url, route, method) {',
    "  if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');",
    "  if (!env.FILES) fail(503, 'File storage is not configured yet. / 文件存储尚未配置，请联系管理员', 'file_storage_setup');",
    "  if (route === '/api/files' && method === 'GET') {",
    '    const pageRaw = Number.parseInt(url.searchParams.get("page") || "1", 10);',
    '    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.min(100000, pageRaw)) : 1;',
    '    const pageSize = 50;',
    "    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM uploaded_files').first();",
    "    const result = await env.DB.prepare('SELECT id,file_name,content_type,size,uploaded_by,uploaded_at FROM uploaded_files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?').bind(pageSize, (page - 1) * pageSize).all();",
    '    return jsonResponse(request, 200, { files:result.results || [], total:Number(count?.total || 0), page, pageSize });',
    '  }',
    "  if (route === '/api/files' && method === 'POST') {",
    '    productFileWriteGuard(request, session);',
    '    const fileName = productFileName(url.searchParams.get("name") || "");',
    '    const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";',
    '    const contentType = PRODUCT_FILE_MIME[extension];',
    "    if (!contentType) fail(415, 'Supported formats: Word, Excel, PDF, PowerPoint, CSV, TXT and product images / 支持 Word、Excel、PDF、PPT、CSV、TXT 和产品图片格式');",
    '    const size = Number(request.headers.get("Content-Length") || 0);',
    "    if (!Number.isSafeInteger(size) || size <= 0) fail(411, 'The upload size could not be verified; please retry in a modern browser / 无法确认文件大小，请使用现代浏览器重试');",
    "    if (size > MAX_PRODUCT_FILE_BYTES) fail(413, 'Each file must be 20 MB or smaller / 单个文件不能超过20MB');",
    '    if (!request.body) fail(400, "The file is empty / 文件内容为空");',
    '    const id = token();',
    "    const objectKey = 'uploads/' + id;",
    '    try {',
    '      await env.FILES.put(objectKey, request.body, { httpMetadata:{ contentType }, customMetadata:{ fileId:id, uploadedBy:session.userId } });',
    '    } catch (error) {',
    "      console.error('[yourz] product file upload failed', String(error?.message || error).slice(0, 240));",
    "      fail(502, 'Cloud file storage failed. No file record was added; please retry. / 云端文件保存失败，未添加文件记录，请重试');",
    '    }',
    '    const uploadedAt = stamp();',
    '    try {',
    '      await env.DB.batch([',
    "        env.DB.prepare('INSERT INTO uploaded_files(id,file_name,content_type,size,object_key,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?)').bind(id, fileName, contentType, size, objectKey, session.userId, uploadedAt),",
    "        env.DB.prepare('INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)').bind(uploadedAt, session.userId, 'file.upload', fileName.slice(0, 250))",
    '      ]);',
    '    } catch (error) {',
    '      try { await env.FILES.delete(objectKey); } catch { /* best-effort cleanup if metadata could not be recorded */ }',
    "      console.error('[yourz] product file metadata save failed', String(error?.message || error).slice(0, 240));",
    "      fail(500, 'The file was uploaded but its record could not be saved; please retry. / 文件上传后资料记录保存失败，请重试');",
    '    }',
    '    return jsonResponse(request, 201, { ok:true, file:{ id, file_name:fileName, content_type:contentType, size, uploaded_by:session.userId, uploaded_at:uploadedAt } });',
    '  }',
    '  const contentMatch = route.match(/^\\/api\\/files\\/([A-Za-z0-9_-]{43})\\/content$/);',
    "  if (contentMatch && method === 'GET') {",
    "    const meta = await env.DB.prepare('SELECT id,file_name,content_type,size,object_key FROM uploaded_files WHERE id=?').bind(contentMatch[1]).first();",
    "    if (!meta) fail(404, 'File not found / 文件不存在');",
    '    const object = await env.FILES.get(meta.object_key);',
    "    if (!object) fail(404, 'File contents are missing from cloud storage / 云端文件内容不存在');",
    '    const encodedName = encodeURIComponent(meta.file_name).replace(/[()\'*!]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());',
    '    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";',
    "    const headers = securityHeaders(new Headers({ 'Content-Type':meta.content_type, 'Content-Length':String(meta.size), 'Content-Disposition':disposition + \"; filename*=UTF-8''\" + encodedName, 'Cache-Control':'private, no-store' }), url.origin);",
    '    return new Response(object.body, { status:200, headers });',
    '  }',
    '  const deleteMatch = route.match(/^\\/api\\/files\\/([A-Za-z0-9_-]{43})$/);',
    "  if (deleteMatch && method === 'DELETE') {",
    '    productFileWriteGuard(request, session);',
    "    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'Use JSON content / 数据格式必须为JSON');",
    '    await parseBody(request);',
    "    const meta = await env.DB.prepare('SELECT id,file_name,object_key FROM uploaded_files WHERE id=?').bind(deleteMatch[1]).first();",
    "    if (!meta) fail(404, 'File not found / 文件不存在');",
    '    await env.FILES.delete(meta.object_key);',
    '    await env.DB.batch([',
    "      env.DB.prepare('DELETE FROM uploaded_files WHERE id=?').bind(meta.id),",
    "      env.DB.prepare('INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)').bind(stamp(), session.userId, 'file.delete', meta.file_name.slice(0, 250))",
    '    ]);',
    '    return jsonResponse(request, 200, { ok:true, id:meta.id });',
    '  }',
    "  if (route.startsWith('/api/files')) fail(405, 'Unsupported file operation / 不支持的文件操作');",
    '  return null;',
    '}',
    helperAnchor
  ].join('\n');
  handler = replaceOnce(handler, helperAnchor, helperPatch, 'product file route helpers');
  const routeAnchor = '  let session = await currentSession(request, env.DB);';
  const routePatch = [
    routeAnchor,
    '  if (route === "/api/files" || route.startsWith("/api/files/")) {',
    '    const response = await handleProductFiles(request, env, session, url, route, method);',
    '    if (response) return response;',
    '  }'
  ].join('\n');
  handler = replaceOnce(handler, routeAnchor, routePatch, 'product file API router');
  write('src/handler.js', handler);
  console.log('Product file storage API added: private R2 objects, D1 metadata, access checks, paging, audit entries, and cleanup on failed metadata writes.');
}

let html = read('public/index.html');
let app = read('public/app.js');
if (!app.includes('YOURZ PRODUCT FILE LIBRARY V1')) {
  const stateAnchor = "let state=C.blank(),view='factories',selected='',query='',dirty=false,stale=false,lastUndo='',toastTimer;";
  const statePatch = stateAnchor + "\n /* YOURZ PRODUCT FILE LIBRARY V1 */\n let productFileRows=[],productFileTotal=0,productFilePage=1,productFilePageSize=50,productFilesLoading=false,activeProductPreviewUrl='';";
  app = replaceOnce(app, stateAnchor, statePatch, 'product file UI state');

  const guideAnchor = '<p class="sub">One shared database for your team / 团队共用一个资料库</p></div><div class="panel guide">';
  const guidePatch = '<p class="sub">One shared database for your team / 团队共用一个资料库</p></div>' + '$' + '{productFilesPanel()}' + '<div class="panel guide">';
  app = replaceOnce(app, guideAnchor, guidePatch, 'insert shared product-file library into Guide & files');

  const helperAnchor = ' function guide(){';
  const helperSource = [
    ' /* YOURZ PRODUCT FILE LIBRARY V1 HELPERS */',
    ' const productExt=name=>String(name||"").split(".").pop().toLowerCase();',
    ' function productSize(n){const v=Number(n)||0;if(v<1024)return v+" B";if(v<1024*1024)return (v/1024).toFixed(1)+" KB";return (v/1024/1024).toFixed(2)+" MB";}',
    ' function productFilesPanel(){return \'<section class="panel"><h2>Shared product files / 产品资料文件库</h2><p>Upload Word, Excel, PDF, PowerPoint, CSV, TXT and product images. Files are shared with teammates and stored in the cloud, not in this browser. Each file can be up to 20 MB. / 支持上传 Word、Excel、PDF、PPT、CSV、TXT 和产品图片；同事可共同查看，文件保存在云端而不是本地浏览器。单个文件最大20MB。</p>\'+(canEdit()?\'<div class="actions"><label class="small" for="productFileInput">Choose files / 选择文件</label><input id="productFileInput" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.webp"><span id="productFileProgress" class="sub" role="status"></span></div>\':\'<p class="notice">View only / 仅查看：请联系管理员开通上传权限。</p>\')+\'<div id="productFileList"><p class="sub">Loading files / 正在载入文件…</p></div></section>\';}',
    ' function renderProductFiles(){const box=document.getElementById("productFileList");if(!box)return;if(!productFileRows.length){box.innerHTML=productFilesLoading?\'<p class="sub">Loading files / 正在载入文件…</p>\':\'<div class="empty"><h3>No shared files / 暂无共享文件</h3><p>Choose a file above to upload the first document. / 从上方选择文件，上传第一份资料。</p></div>\';return;}',
    ' const rows=productFileRows.map(f=>[esc(f.file_name),productSize(f.size),esc(f.uploaded_by||""),esc(String(f.uploaded_at||"").replace("T"," ").replace(/\\.\\d+Z$/," UTC")),\'<button class="small" data-file-act="preview" data-file-id="\'+esc(f.id)+\'">Preview / 预览</button> <button class="small" data-file-act="download" data-file-id="\'+esc(f.id)+\'">Download / 下载</button> \'+(canEdit()?\'<button class="small danger" data-file-act="delete" data-file-id="\'+esc(f.id)+\'">Delete / 删除</button>\':\'\')]);',
    ' box.innerHTML=table(["File / 文件名","Size / 大小","Uploaded by / 上传人","Uploaded at / 上传时间","Actions / 操作"],rows)+(productFileTotal>productFilePageSize?\'<div class="actions"><button class="small" data-file-act="prev" \'+(productFilePage<=1?"disabled":"")+ \'>Previous / 上一页</button><span class="sub">Page / 页 \'+productFilePage+\' · \'+productFileTotal+\' files / 个文件</span><button class="small" data-file-act="next" \'+(productFilePage*productFilePageSize>=productFileTotal?"disabled":"")+ \'>Next / 下一页</button></div>\':\'<p class="sub">Showing / 显示 \'+productFileRows.length+\' of / 共 \'+productFileTotal+\' files / 个文件</p>\');}',
    ' async function loadProductFiles(silent){if(productFilesLoading||!session)return;productFilesLoading=true;renderProductFiles();try{const data=await api("/api/files?page="+productFilePage);productFileRows=data.files||[];productFileTotal=Number(data.total)||0;productFilePage=Number(data.page)||1;productFilePageSize=Number(data.pageSize)||50;renderProductFiles();}catch(error){const box=document.getElementById("productFileList");if(box)box.innerHTML=\'<p class="notice error">\'+esc(error.message||String(error))+\'</p>\';if(!silent)toast(error.message||String(error));}finally{productFilesLoading=false;}}',
    ' async function uploadProductFiles(files){if(!canEdit())throw Error("Ask your administrator for upload access / 请联系管理员开通上传权限");if(stale||busy)throw Error("Load latest records and finish saving before uploading / 请先载入最新资料并等待保存完成");const progress=document.getElementById("productFileProgress");const input=document.getElementById("productFileInput");let done=0;const failed=[];productFilePage=1;if(progress)progress.textContent="Preparing / 准备上传 "+files.length+" file(s)…";for(const file of files){if(file.size<=0){failed.push(file.name+": empty / 文件为空");continue;}if(file.size>20*1024*1024){failed.push(file.name+": exceeds 20 MB / 超过20MB");continue;}if(progress)progress.textContent="Uploading / 正在上传 "+(done+1)+"/"+files.length+": "+file.name;try{const response=await fetch("/api/files?name="+encodeURIComponent(file.name),{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"X-CSRF-Token":session?.csrf||"","Content-Type":file.type||"application/octet-stream"},body:file});let data={};try{data=await response.json();}catch{}if(!response.ok)throw Error(data.error||("HTTP "+response.status));done++;}catch(error){failed.push(file.name+": "+(error.message||String(error)));}}if(input)input.value="";await loadProductFiles(true);if(progress)progress.textContent=failed.length?"Uploaded / 已上传 "+done+"; failed / 失败 "+failed.length:"Upload complete / 上传完成 "+done+" file(s)";if(failed.length)toast("Upload results / 上传结果：成功 "+done+"，失败 "+failed.length+"。"+failed.slice(0,2).join("；"));else toast("Upload complete / 上传完成："+done+" 个文件");}',
    ' function bindProductFileInput(){const input=document.getElementById("productFileInput");if(input)input.onchange=async event=>{const files=Array.from(event.target.files||[]);if(!files.length)return;try{await uploadProductFiles(files);}catch(error){toast(error.message||String(error));}};}',
    ' async function getProductFileBlob(id,download){const url="/api/files/"+encodeURIComponent(id)+"/content"+(download?"?download=1":"");const response=await fetch(url,{credentials:"same-origin",cache:"no-store"});if(!response.ok){let data={};try{data=await response.json();}catch{}throw Error(data.error||("HTTP "+response.status));}return response.blob();}',
    ' function downloadProductBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.rel="noopener";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}',
    ' function closeProductPreview(){if(modal.open)modal.close();if(activeProductPreviewUrl){URL.revokeObjectURL(activeProductPreviewUrl);activeProductPreviewUrl="";}}',
    ' function showProductPreview(file,blob,content,type){if(activeProductPreviewUrl){URL.revokeObjectURL(activeProductPreviewUrl);activeProductPreviewUrl="";}dirty=false;modal.innerHTML=\'<div class="dialoghead"><h2>\'+esc(file.file_name)+\'</h2><button type="button" id="closeProductPreview" aria-label="Close / 关闭">×</button></div><div class="formbody product-file-preview" id="productPreviewBody">\'+content+\'</div><div class="footactions"><button type="button" id="downloadProductOriginal">Download original / 下载原件</button><button type="button" class="primary" id="closeProductPreviewBottom">Close / 关闭</button></div>\';modal.showModal();document.getElementById("closeProductPreview").onclick=closeProductPreview;document.getElementById("closeProductPreviewBottom").onclick=closeProductPreview;document.getElementById("downloadProductOriginal").onclick=()=>downloadProductBlob(blob,file.file_name);if(type==="pdf"){activeProductPreviewUrl=URL.createObjectURL(blob);document.getElementById("productPreviewFrame").src=activeProductPreviewUrl;}else if(type==="image"){activeProductPreviewUrl=URL.createObjectURL(blob);document.getElementById("productPreviewImage").src=activeProductPreviewUrl;}}',
    ' async function previewProductFile(id){const file=productFileRows.find(row=>row.id===id);if(!file)throw Error("Reload the file list and retry / 请刷新文件列表后重试");const blob=await getProductFileBlob(id,false);const ext=productExt(file.file_name);let content="";let type="text";',
    ' if(ext==="pdf"){content=\'<iframe id="productPreviewFrame" title="PDF preview / PDF预览" class="product-pdf-preview"></iframe>\';type="pdf";}',
    ' else if(["png","jpg","jpeg","webp"].includes(ext)){content=\'<img id="productPreviewImage" class="product-image-preview" alt="\'+esc(file.file_name)+\'">\';type="image";}',
    ' else if(["xlsx","xls"].includes(ext)){if(!window.XLSX)throw Error("Excel preview module is missing / Excel 预览模块未加载");const workbook=XLSX.read(await blob.arrayBuffer(),{type:"array",cellDates:true});content=workbook.SheetNames.slice(0,10).map(sheet=>{const data=XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,raw:false,defval:""});const shown=data.slice(0,151).map(row=>row.slice(0,30));const body=shown.map((row,i)=>"<tr>"+row.map(cell=>i===0?"<th>"+esc(cell)+"</th>":"<td>"+esc(cell)+"</td>").join("")+"</tr>").join("");return "<section><h3>"+esc(sheet)+"</h3><div class=\\\"tablewrap\\\"><table><tbody>"+body+"</tbody></table></div>"+(data.length>151?"<p class=\\\"sub\\\">Preview limited to first 150 rows / 预览仅显示前150行</p>":"")+"</section>";}).join("")||"<p>No worksheets / 没有工作表</p>";}',
    ' else if(ext==="docx"){if(!window.JSZip)throw Error("Document preview module is missing / 文档预览模块未加载");const zip=await JSZip.loadAsync(await blob.arrayBuffer());const entry=zip.file("word/document.xml");if(!entry)throw Error("No Word document body found / 未找到 Word 正文");const xml=new DOMParser().parseFromString(await entry.async("text"),"application/xml");const ns="http://schemas.openxmlformats.org/wordprocessingml/2006/main";const paras=Array.from(xml.getElementsByTagNameNS(ns,"p")).map(p=>Array.from(p.getElementsByTagNameNS(ns,"t")).map(t=>t.textContent||"").join("")).filter(p=>p.trim());content=paras.map(p=>"<p>"+esc(p)+"</p>").join("")||"<p>No text available / 没有可预览文字</p>";content="<p class=\\\"notice\\\">Word text preview / Word文字预览（简化格式）</p>"+content;}',
    ' else if(ext==="pptx"){if(!window.JSZip)throw Error("PowerPoint preview module is missing / PPT预览模块未加载");const zip=await JSZip.loadAsync(await blob.arrayBuffer());const names=Object.keys(zip.files).filter(n=>/^ppt\\/slides\\/slide\\d+\\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\\d+)/)[1])-Number(b.match(/slide(\\d+)/)[1])).slice(0,60);const ns="http://schemas.openxmlformats.org/drawingml/2006/main";content=await Promise.all(names.map(async(name,index)=>{const xml=new DOMParser().parseFromString(await zip.file(name).async("text"),"application/xml");const texts=Array.from(xml.getElementsByTagNameNS(ns,"t")).map(t=>(t.textContent||"").trim()).filter(Boolean);return "<section class=\\\"pptx-slide-preview\\\"><h3>Slide / 幻灯片 "+(index+1)+"</h3><p>"+(texts.length?texts.map(esc).join("<br>"):"No extractable text / 没有可提取文字")+"</p></section>";})).then(parts=>parts.join(""));if(!content)content="<p>No slides found / 没有找到幻灯片</p>";content="<p class=\\\"notice\\\">PowerPoint text preview / PPT文字预览（原始布局请下载原件）</p>"+content;}',
    ' else if(["txt","csv"].includes(ext)){content="<pre>"+esc((await blob.text()).slice(0,200000))+"</pre>";if(blob.size>200000)content+="<p class=\\\"sub\\\">Preview limited to 200 KB / 预览仅显示前200KB</p>";}',
    ' else {content=\'<div class="empty"><h3>Preview not available / 暂不支持在线预览</h3><p>This older Office format can still be downloaded and opened in Microsoft Office or compatible software. / 此旧版 Office 格式可下载后用 Microsoft Office 或兼容软件打开。</p></div>\';}',
    ' showProductPreview(file,blob,content,type);}',
    ' async function deleteProductFile(id){const file=productFileRows.find(row=>row.id===id);if(!file)return;if(!canEdit())throw Error("Upload/delete access required / 需要上传或删除权限");if(!confirm("Delete this shared file for everyone? This cannot be undone here. / 为所有人删除此共享文件？此操作无法在这里撤销。\\n\\n"+file.file_name))return;await api("/api/files/"+encodeURIComponent(id),{method:"DELETE",body:{}});if(productFileRows.length===1&&productFilePage>1)productFilePage--;await loadProductFiles(false);toast("File deleted / 文件已删除");}',
    ' main.addEventListener("click",async event=>{const b=event.target.closest("[data-file-act]");if(!b)return;const id=b.dataset.fileId;try{switch(b.dataset.fileAct){case "preview":await previewProductFile(id);break;case "download":{const file=productFileRows.find(row=>row.id===id);const blob=await getProductFileBlob(id,true);downloadProductBlob(blob,file?.file_name||"product-file");break;}case "delete":await deleteProductFile(id);break;case "prev":productFilePage=Math.max(1,productFilePage-1);await loadProductFiles(false);break;case "next":if(productFilePage*productFilePageSize<productFileTotal){productFilePage++;await loadProductFiles(false);}break;}}catch(error){toast(error.message||String(error));}});',
    ' modal.addEventListener("close",()=>{if(activeProductPreviewUrl){URL.revokeObjectURL(activeProductPreviewUrl);activeProductPreviewUrl="";}});',
    ''
  ].join('\n');
  app = replaceOnce(app, helperAnchor, helperSource + '\n' + helperAnchor, 'product file browser handlers');

  const renderAnchor = 'main.innerHTML=banner()+content;const search=document.getElementById(\'search\');if(search)';
  const renderPatch = 'main.innerHTML=banner()+content;if(view===\'guide\'){renderProductFiles();bindProductFileInput();if(!productFilesLoading)loadProductFiles(true).catch(()=>{});}const search=document.getElementById(\'search\');if(search)';
  app = replaceOnce(app, renderAnchor, renderPatch, 'load shared file list in Guide & files view');
  write('public/app.js', app);
  console.log('Product file UI added: upload, paged shared listing, download, PDF/image preview, Excel tables, and readable Word/PPT text preview.');
}

const version = 'v=yourz-refresh-20261016-3&safe-import=20261016-1&files-v1=20261016-1';
const scriptAnchor = '<script src="/core.js" defer></script>';
const scriptReplacement = '<script src="/vendor/xlsx.full.min.js" defer></script><script src="/vendor/jszip.min.js" defer></script>' + scriptAnchor;
if (!html.includes('/vendor/xlsx.full.min.js')) html = replaceOnce(html, scriptAnchor, scriptReplacement, 'load local preview libraries before the application');
const scriptRef = /(<script\b[^>]*\bsrc=["'])([^"']*app\.js)(?:\?[^"']*)?(["'][^>]*>)/i;
const scriptMatch = html.match(scriptRef);
if (!scriptMatch) throw new Error('Could not find app.js reference in index.html.');
html = html.replace(scriptRef, scriptMatch[1] + scriptMatch[2] + '?' + version + scriptMatch[3]);
write('public/index.html', html);

const vendors = [
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'public/vendor/xlsx.full.min.js'],
  ['node_modules/jszip/dist/jszip.min.js', 'public/vendor/jszip.min.js']
];
fs.mkdirSync(path.join(root, 'public/vendor'), { recursive:true });
for (const [from,to] of vendors) {
  if (!fs.existsSync(path.join(root,from))) throw new Error('Missing preview dependency ' + from + '; install xlsx and jszip before applying this patch.');
  fs.copyFileSync(path.join(root,from),path.join(root,to));
}
console.log('Local preview libraries copied to public/vendor; no third-party preview URL or public file link is used.');
