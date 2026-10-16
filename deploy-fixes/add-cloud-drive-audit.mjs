import fs from 'node:fs';

const root = process.argv[2] || 'app';
const read = p => fs.readFileSync(root + '/' + p, 'utf8');
const write = (p, s) => fs.writeFileSync(root + '/' + p, s);
function once(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Patch target missing: ' + label);
  return source.replace(before, after);
}
const tick = String.fromCharCode(96);

let h = read('src/handler.js');
h = once(h,
  "const SESSION_COOKIE = '__Host-factory-session';",
  "const VISITOR_COOKIE = '__Host-yourz-visitor';\nconst MAX_FILE_BYTES = 25 * 1024 * 1024;\nconst DRIVE_EXTENSIONS = new Set(['doc','docx','xls','xlsx','ppt','pptx','pdf','csv','txt','png','jpg','jpeg','webp','gif']);\nconst DRIVE_CATEGORIES = new Set(['quote','spec','certificate','catalog','packaging','other']);\nconst SESSION_COOKIE = '__Host-factory-session';",
  'visitor and file constants');

const schemaAfter = [
"CREATE INDEX IF NOT EXISTS idx_audit_id ON audit(id DESC);",
"CREATE TABLE IF NOT EXISTS visitors (",
" visitor_id TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,",
" last_ip TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',",
" city TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '',",
" os TEXT NOT NULL DEFAULT '', device_label TEXT NOT NULL DEFAULT ''",
");",
"CREATE TABLE IF NOT EXISTS audit_events (",
" id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, visitor_id TEXT NOT NULL,",
" user_id TEXT NOT NULL DEFAULT 'anonymous', ip TEXT NOT NULL DEFAULT '',",
" country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',",
" user_agent TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '',",
" method TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT '',",
" target_id TEXT NOT NULL DEFAULT '', target_name TEXT NOT NULL DEFAULT '',",
" details TEXT NOT NULL DEFAULT '{}', outcome TEXT NOT NULL DEFAULT 'success', status_code INTEGER NOT NULL DEFAULT 200",
");",
"CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(id DESC);",
"CREATE INDEX IF NOT EXISTS idx_audit_events_visitor ON audit_events(visitor_id, id DESC);",
"CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_type, target_id, id DESC);",
"CREATE TABLE IF NOT EXISTS drive_folders (",
" id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, parent_id TEXT,",
" created_at TEXT NOT NULL, created_by TEXT NOT NULL, visitor_id TEXT NOT NULL, deleted_at TEXT",
");",
"CREATE TABLE IF NOT EXISTS drive_files (",
" id TEXT PRIMARY KEY, original_filename TEXT NOT NULL, extension TEXT NOT NULL,",
" content_type TEXT NOT NULL, file_size INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'other',",
" folder_id TEXT, factory_id TEXT, r2_key TEXT NOT NULL,",
" uploaded_by TEXT NOT NULL, visitor_id TEXT NOT NULL, uploaded_at TEXT NOT NULL,",
" updated_at TEXT NOT NULL, deleted_at TEXT, current_version INTEGER NOT NULL DEFAULT 1",
");",
"CREATE INDEX IF NOT EXISTS idx_drive_files_updated ON drive_files(deleted_at, updated_at DESC);",
"CREATE INDEX IF NOT EXISTS idx_drive_files_factory ON drive_files(factory_id, deleted_at, updated_at DESC);",
"CREATE INDEX IF NOT EXISTS idx_drive_files_folder ON drive_files(folder_id, deleted_at, updated_at DESC);",
"CREATE INDEX IF NOT EXISTS idx_drive_files_name ON drive_files(original_filename);",
"CREATE TABLE IF NOT EXISTS drive_file_versions (",
" id TEXT PRIMARY KEY, file_id TEXT NOT NULL, version_no INTEGER NOT NULL,",
" original_filename TEXT NOT NULL, extension TEXT NOT NULL, content_type TEXT NOT NULL,",
" file_size INTEGER NOT NULL, r2_key TEXT NOT NULL, uploaded_by TEXT NOT NULL,",
" visitor_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(file_id, version_no)",
");",
"CREATE INDEX IF NOT EXISTS idx_drive_versions_file ON drive_file_versions(file_id, version_no DESC);",
"CREATE TABLE IF NOT EXISTS office_preview_tokens (",
" token_hash TEXT PRIMARY KEY, file_id TEXT NOT NULL, visitor_id TEXT NOT NULL,",
" expires_at INTEGER NOT NULL, created_at TEXT NOT NULL",
");",
"CREATE INDEX IF NOT EXISTS idx_office_preview_expires ON office_preview_tokens(expires_at);"
].join('\n') + '\n' + tick + ';';
const schemaBefore = 'CREATE INDEX IF NOT EXISTS idx_audit_id ON audit(id DESC);\n' + tick + ';';
h = once(h,schemaBefore,schemaAfter,'drive and audit tables');

const helpers = [
"function writeGuardRaw(request,session) {",
"  if(!session) fail(401,'请先重新打开网站以初始化匿名访问会话');",
"  if(!['admin','editor'].includes(session.role)) fail(403,'没有上传或修改权限');",
"  requireOrigin(request); if(request.headers.get('X-CSRF-Token')!==session.csrf) fail(403,'无法验证请求，请刷新应用');",
"}",
"function browserInfo(ua) {",
"  const browser = /Edg\\//.test(ua) ? 'Edge' : /Firefox\\//.test(ua) ? 'Firefox' : /Chrome\\//.test(ua) ? 'Chrome' : /Safari\\//.test(ua) ? 'Safari' : /MSIE|Trident\\//.test(ua) ? 'Internet Explorer' : 'Other';",
"  const os = /Windows NT/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Other';",
"  return { browser, os };",
"}",
"async function ensureVisitor(request, db) {",
"  const incoming = cookieValue(request, VISITOR_COOKIE);",
"  const valid = /^[A-Za-z0-9_-]{43}$/.test(incoming);",
"  const raw = valid ? incoming : token();",
"  const digest = await sha256Hex(raw);",
"  const visitorId = 'VIS-' + digest.slice(0, 12).toUpperCase();",
"  const ua = String(request.headers.get('User-Agent') || '').slice(0, 700);",
"  const info = browserInfo(ua);",
"  const cf = request.cf || {};",
"  const ip = String(request.headers.get('CF-Connecting-IP') || '').slice(0, 64);",
"  const country = String(cf.country || '').slice(0, 80);",
"  const region = String(cf.region || cf.regionCode || '').slice(0, 120);",
"  const city = String(cf.city || '').slice(0, 120);",
"  const now = stamp();",
"  await db.prepare('INSERT INTO visitors(visitor_id,first_seen,last_seen,last_ip,country,region,city,user_agent,browser,os,device_label) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET last_seen=excluded.last_seen,last_ip=CASE WHEN excluded.last_ip=\\'\\' THEN visitors.last_ip ELSE excluded.last_ip END,country=CASE WHEN excluded.country=\\'\\' THEN visitors.country ELSE excluded.country END,region=CASE WHEN excluded.region=\\'\\' THEN visitors.region ELSE excluded.region END,city=CASE WHEN excluded.city=\\'\\' THEN visitors.city ELSE excluded.city END,user_agent=excluded.user_agent,browser=excluded.browser,os=excluded.os').bind(visitorId,now,now,ip,country,region,city,ua,info.browser,info.os,'').run();",
"  const row = await db.prepare('SELECT device_label FROM visitors WHERE visitor_id=?').bind(visitorId).first();",
"  return { visitorId, raw, setCookie:valid?'':VISITOR_COOKIE+'='+raw+'; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax', ip, country, region, city, userAgent:ua, browser:info.browser, os:info.os, deviceLabel:row?.device_label || '' };",
"}",
"async function writeAuditEvent(db, visitor, session, event) {",
"  const v = visitor || {};",
"  let details = '{}';",
"  try { details = JSON.stringify(event.details || {}); } catch { details = '{}'; }",
"  if (details.length > 5000) details = JSON.stringify({ truncated:true, preview:details.slice(0,4700) });",
"  await db.prepare('INSERT INTO audit_events(at,visitor_id,user_id,ip,country,region,city,user_agent,browser,os,method,action,target_type,target_id,target_name,details,outcome,status_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(stamp(),v.visitorId || 'UNKNOWN',session?.userId || 'anonymous',v.ip || '',v.country || '',v.region || '',v.city || '',v.userAgent || '',v.browser || '',v.os || '',event.method || 'API',event.action || 'unknown',event.targetType || '',String(event.targetId || '').slice(0,120),String(event.targetName || '').slice(0,240),details,event.outcome || 'success',Number(event.statusCode || 200)).run();",
"}",
"async function writeAuditQuietly(db, visitor, session, event) { try { await writeAuditEvent(db,visitor,session,event); } catch (e) { console.error('[yourz] audit write failed',String(e?.message || e).slice(0,180)); } }",
"function safeFilename(raw) {",
"  let name = String(raw || ''); try { name = decodeURIComponent(name); } catch { fail(400,'文件名编码无效'); }",
"  name = name.replace(/\\\\/g,'/').split('/').pop().replace(/[\\x00-\\x1F\\x7F]/g,'').trim();",
"  if (!name || name.length > 240 || name === '.' || name === '..') fail(400,'文件名不能为空且不能超过240个字符');",
"  return name;",
"}",
"function fileExtension(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }",
"function mimeForExtension(ext) { return ({pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',csv:'text/csv; charset=utf-8',txt:'text/plain; charset=utf-8',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'})[ext] || 'application/octet-stream'; }",
"function fileDisposition(name, mode) { const fallback = name.replace(/[^\\x20-\\x7E]/g,'_').replace(/[\"\\\\]/g,'_'); return (mode || 'inline') + '; filename=\"' + fallback + '\"'; }",
"function validateCategory(value) { const v = String(value || 'other'); if (!DRIVE_CATEGORIES.has(v)) fail(400,'资料分类无效'); return v; }",
"function validateFolderName(value) { const v = text(value,100); if (!v || /[\\\\/\\x00-\\x1F]/.test(v)) fail(400,'文件夹名称不能为空，且不能包含斜线或控制字符'); return v; }",
"function clampInteger(value,fallback,min,max) { const n=Number(value); return Number.isSafeInteger(n)?Math.max(min,Math.min(max,n)):fallback; }",
"async function currentDriveFile(db,id,includeDeleted=false) { const file=await db.prepare('SELECT * FROM drive_files WHERE id=?').bind(text(id,80)).first(); if(!file||(!includeDeleted&&file.deleted_at)) fail(404,'文件不存在或已在回收站'); return file; }",
"async function validateFactoryId(db,id) { if(!id)return null; const state=await readState(db); const f=C.factory(state,text(id,80)); if(f.status!=='active')fail(400,'只能关联使用中的工厂'); return f; }",
"async function validateFolderId(db,id) { if(!id)return null; const row=await db.prepare('SELECT id FROM drive_folders WHERE id=? AND deleted_at IS NULL').bind(text(id,80)).first(); if(!row)fail(400,'文件夹不存在或已删除'); return row.id; }",
"function streamDriveObject(request,obj,file,mode) { if(!obj)fail(404,'文件内容不存在'); const headers=new Headers(); headers.set('Content-Type',file.content_type||mimeForExtension(file.extension)); headers.set('Content-Disposition',fileDisposition(file.original_filename,mode||'inline')); headers.set('Content-Length',String(file.file_size)); headers.set('Cache-Control','private, no-store'); headers.set('X-Content-Type-Options','nosniff'); return new Response(request.method==='HEAD'?null:obj.body,{status:200,headers}); }",
"async function handleDriveApi(request,env,session,visitor) {",
"  if(!env.FILES) fail(503,'云盘尚未绑定 Cloudflare R2。测试通过后需在 Cloudflare Pages 添加名为 FILES 的 R2 bucket 绑定；本次不会自动改动生产环境。','drive_setup');",
"  const url=new URL(request.url),route=url.pathname,method=request.method.toUpperCase(),db=env.DB;",
"  if(route==='/api/files'&&method==='GET'){",
"    const page=clampInteger(url.searchParams.get('page'),1,1,1000000),pageSize=clampInteger(url.searchParams.get('pageSize'),50,1,100),trash=url.searchParams.get('trash')==='1';",
"    const where=[trash?'deleted_at IS NOT NULL':'deleted_at IS NULL'],args=[]; const q=String(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,120).replace(/[%_]/g,'');",
"    if(q){where.push('LOWER(original_filename) LIKE ?');args.push('%'+q+'%');}",
"    const factoryId=String(url.searchParams.get('factoryId')||'');if(factoryId){where.push('factory_id=?');args.push(factoryId);}",
"    const folderId=String(url.searchParams.get('folderId')||'');if(folderId==='root')where.push('folder_id IS NULL');else if(folderId&&folderId!=='all'){where.push('folder_id=?');args.push(folderId);}",
"    const category=String(url.searchParams.get('category')||'');if(category&&category!=='all'){where.push('category=?');args.push(validateCategory(category));}",
"    const clause=where.join(' AND '),count=await db.prepare('SELECT COUNT(*) AS total FROM drive_files WHERE '+clause).bind(...args).first();",
"    const result=await db.prepare('SELECT id,original_filename,extension,content_type,file_size,category,folder_id,factory_id,uploaded_by,visitor_id,uploaded_at,updated_at,deleted_at,current_version FROM drive_files WHERE '+clause+' ORDER BY updated_at DESC LIMIT ? OFFSET ?').bind(...args,pageSize,(page-1)*pageSize).all();",
"    await writeAuditQuietly(db,visitor,session,{method:'GET',action:'file.list',targetType:'folder',targetId:folderId,targetName:factoryId,details:{page,pageSize,trash,category:category||'all',queryPresent:!!q}});",
"    return jsonResponse(request,200,{files:result.results||[],total:Number(count?.total||0),page,pageSize,trash});",
"  }",
"  if(route==='/api/files/folders'&&method==='GET'){const result=await db.prepare('SELECT id,name,parent_id,created_at,created_by FROM drive_folders WHERE deleted_at IS NULL ORDER BY name').all();return jsonResponse(request,200,{folders:result.results||[]});}",
"  if(route==='/api/files/folders'&&method==='POST'){",
"    writeGuard(request,session);const input=await parseBody(request),name=validateFolderName(input.name);const exists=await db.prepare('SELECT id FROM drive_folders WHERE LOWER(name)=LOWER(?) AND deleted_at IS NULL').bind(name).first();if(exists)fail(409,'同名文件夹已存在');",
"    const id=crypto.randomUUID(),at=stamp();await db.prepare('INSERT INTO drive_folders(id,name,parent_id,created_at,created_by,visitor_id) VALUES(?,?,?,?,?,?)').bind(id,name,null,at,session.userId,visitor?.visitorId||'UNKNOWN').run();",
"    await writeAuditQuietly(db,visitor,session,{method:'POST',action:'folder.create',targetType:'folder',targetId:id,targetName:name});return jsonResponse(request,200,{ok:true,id,name});",
"  }",
"  if(route==='/api/files/upload'&&method==='POST'){",
"    writeGuardRaw(request,session);const name=safeFilename(request.headers.get('X-File-Name')||''),ext=fileExtension(name);if(!DRIVE_EXTENSIONS.has(ext))fail(415,'暂不支持该文件格式；请上传 Word、Excel、PDF、PPT、CSV、TXT 或常见图片。');",
"    const contentLength=Number(request.headers.get('Content-Length')||0);if(contentLength>MAX_FILE_BYTES)fail(413,'单个文件暂限25MB');const bytes=await request.arrayBuffer();if(bytes.byteLength>MAX_FILE_BYTES)fail(413,'单个文件暂限25MB');",
"    const factoryId=String(url.searchParams.get('factoryId')||'');if(factoryId)await validateFactoryId(db,factoryId);const folderId=await validateFolderId(db,String(url.searchParams.get('folderId')||''));const category=validateCategory(url.searchParams.get('category')||'other');",
"    const id=crypto.randomUUID(),at=stamp(),key='files/'+id+'/v1/'+token()+'.'+ext,mime=mimeForExtension(ext);await env.FILES.put(key,bytes,{httpMetadata:{contentType:mime,contentDisposition:fileDisposition(name,'inline')},customMetadata:{fileId:id}});",
"    try{await db.batch([db.prepare('INSERT INTO drive_files(id,original_filename,extension,content_type,file_size,category,folder_id,factory_id,r2_key,uploaded_by,visitor_id,uploaded_at,updated_at,current_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)').bind(id,name,ext,mime,bytes.byteLength,category,folderId,factoryId||null,key,session.userId,visitor?.visitorId||'UNKNOWN',at,at),db.prepare('INSERT INTO drive_file_versions(id,file_id,version_no,original_filename,extension,content_type,file_size,r2_key,uploaded_by,visitor_id,created_at) VALUES(?,?,1,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,name,ext,mime,bytes.byteLength,key,session.userId,visitor?.visitorId||'UNKNOWN',at)]);}catch(e){try{await env.FILES.delete(key);}catch{}throw e;}",
"    await writeAuditQuietly(db,visitor,session,{method:'POST',action:'file.upload',targetType:'file',targetId:id,targetName:name,details:{extension:ext,size:bytes.byteLength,category,factoryId:factoryId||null,folderId}});return jsonResponse(request,200,{ok:true,id,original_filename:name,file_size:bytes.byteLength});",
"  }",
"  if(route==='/api/files/replace'&&method==='POST'){",
"    writeGuardRaw(request,session);const id=String(url.searchParams.get('id')||''),old=await currentDriveFile(db,id);const name=request.headers.get('X-File-Name')?safeFilename(request.headers.get('X-File-Name')):old.original_filename,ext=fileExtension(name);",
"    if(!DRIVE_EXTENSIONS.has(ext))fail(415,'不支持的文件格式');if(ext!==old.extension)fail(400,'替换文件必须与原文件使用相同格式');const contentLength=Number(request.headers.get('Content-Length')||0);if(contentLength>MAX_FILE_BYTES)fail(413,'单个文件暂限25MB');const bytes=await request.arrayBuffer();if(bytes.byteLength>MAX_FILE_BYTES)fail(413,'单个文件暂限25MB');",
"    const vr=await db.prepare('SELECT COALESCE(MAX(version_no),0)+1 AS next FROM drive_file_versions WHERE file_id=?').bind(id).first(),versionNo=Number(vr?.next||Number(old.current_version)+1),at=stamp(),key='files/'+id+'/v'+versionNo+'/'+token()+'.'+ext,mime=mimeForExtension(ext);",
"    await env.FILES.put(key,bytes,{httpMetadata:{contentType:mime,contentDisposition:fileDisposition(name,'inline')},customMetadata:{fileId:id,version:String(versionNo)}});",
"    try{await db.batch([db.prepare('INSERT INTO drive_file_versions(id,file_id,version_no,original_filename,extension,content_type,file_size,r2_key,uploaded_by,visitor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,versionNo,name,ext,mime,bytes.byteLength,key,session.userId,visitor?.visitorId||'UNKNOWN',at),db.prepare('UPDATE drive_files SET original_filename=?,content_type=?,file_size=?,r2_key=?,current_version=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(name,mime,bytes.byteLength,key,versionNo,at,id)]);}catch(e){try{await env.FILES.delete(key);}catch{}throw e;}",
"    await writeAuditQuietly(db,visitor,session,{method:'POST',action:'file.replace',targetType:'file',targetId:id,targetName:name,details:{version:versionNo,size:bytes.byteLength}});return jsonResponse(request,200,{ok:true,id,version:versionNo});",
"  }",
"  if(route==='/api/files/download'&&(method==='GET'||method==='HEAD')){const file=await currentDriveFile(db,url.searchParams.get('id')),obj=await env.FILES.get(file.r2_key);if(!obj)fail(404,'文件内容不存在');await writeAuditQuietly(db,visitor,session,{method,action:'file.download',targetType:'file',targetId:file.id,targetName:file.original_filename,details:{size:file.file_size}});return streamDriveObject(request,obj,file,'attachment');}",
"  if(route==='/api/files/preview'&&(method==='GET'||method==='HEAD')){const file=await currentDriveFile(db,url.searchParams.get('id')),obj=await env.FILES.get(file.r2_key);if(!obj)fail(404,'文件内容不存在');if(!['pdf','png','jpg','jpeg','webp','gif','txt','csv'].includes(file.extension))fail(415,'此格式请使用在线 Office 预览或下载原文件');await writeAuditQuietly(db,visitor,session,{method,action:'file.preview',targetType:'file',targetId:file.id,targetName:file.original_filename,details:{extension:file.extension}});return streamDriveObject(request,obj,file,'inline');}",
"  if(route==='/api/files/preview-token'&&method==='POST'){",
"    writeGuard(request,session);const input=await parseBody(request),file=await currentDriveFile(db,input.id);if(!['doc','docx','xls','xlsx','ppt','pptx'].includes(file.extension))fail(400,'此文件不需要 Office 在线预览');",
"    const raw=token(),hash=await sha256Hex(raw),expiry=Date.now()+15*60*1000;await db.prepare('DELETE FROM office_preview_tokens WHERE expires_at<=?').bind(Date.now()).run();await db.prepare('INSERT INTO office_preview_tokens(token_hash,file_id,visitor_id,expires_at,created_at) VALUES(?,?,?,?,?)').bind(hash,file.id,visitor?.visitorId||'UNKNOWN',expiry,stamp()).run();",
"    const sourceUrl=new URL('/api/office-source/'+raw,url.origin).toString();await writeAuditQuietly(db,visitor,session,{method:'POST',action:'file.preview.office',targetType:'file',targetId:file.id,targetName:file.original_filename,details:{provider:'Microsoft Office Online Viewer',tokenExpiresAt:new Date(expiry).toISOString()}});return jsonResponse(request,200,{url:sourceUrl,expiresAt:new Date(expiry).toISOString(),provider:'Microsoft Office Online Viewer'});",
"  }",
"  if(route==='/api/files/versions'&&method==='GET'){const file=await currentDriveFile(db,url.searchParams.get('id'),true),result=await db.prepare('SELECT id,file_id,version_no,original_filename,extension,content_type,file_size,uploaded_by,visitor_id,created_at FROM drive_file_versions WHERE file_id=? ORDER BY version_no DESC').bind(file.id).all();return jsonResponse(request,200,{file:{id:file.id,original_filename:file.original_filename,current_version:file.current_version},versions:result.results||[]});}",
"  if(route==='/api/files/restore-version'&&method==='POST'){writeGuard(request,session);const input=await parseBody(request),file=await currentDriveFile(db,input.id,true);if(file.deleted_at)fail(400,'请先从回收站恢复文件');const version=await db.prepare('SELECT * FROM drive_file_versions WHERE file_id=? AND version_no=?').bind(file.id,Number(input.version)).first();if(!version)fail(404,'文件版本不存在');const at=stamp();await db.prepare('UPDATE drive_files SET original_filename=?,extension=?,content_type=?,file_size=?,r2_key=?,current_version=?,updated_at=? WHERE id=?').bind(version.original_filename,version.extension,version.content_type,version.file_size,version.r2_key,version.version_no,at,file.id).run();await writeAuditQuietly(db,visitor,session,{method:'POST',action:'file.version.restore',targetType:'file',targetId:file.id,targetName:version.original_filename,details:{version:version.version_no}});return jsonResponse(request,200,{ok:true,version:version.version_no});}",
"  if(route==='/api/files/action'&&method==='POST'){",
"    writeGuard(request,session);const input=await parseBody(request),file=await currentDriveFile(db,input.id,true),at=stamp();",
"    if(input.action==='delete'){if(file.deleted_at)fail(400,'文件已在回收站');await db.prepare('UPDATE drive_files SET deleted_at=?,updated_at=? WHERE id=?').bind(at,at,file.id).run();}",
"    else if(input.action==='restore'){if(!file.deleted_at)fail(400,'文件不在回收站');await db.prepare('UPDATE drive_files SET deleted_at=NULL,updated_at=? WHERE id=?').bind(at,file.id).run();}",
"    else if(input.action==='rename'){if(file.deleted_at)fail(400,'请先恢复文件');const name=safeFilename(input.name);if(fileExtension(name)!==file.extension)fail(400,'重命名时不能更改文件格式');await db.prepare('UPDATE drive_files SET original_filename=?,updated_at=? WHERE id=?').bind(name,at,file.id).run();}",
"    else if(input.action==='meta'){if(file.deleted_at)fail(400,'请先恢复文件');const category=validateCategory(input.category||file.category),factoryId=input.factoryId?String(input.factoryId):'';if(factoryId)await validateFactoryId(db,factoryId);const folderId=await validateFolderId(db,String(input.folderId||''));await db.prepare('UPDATE drive_files SET category=?,factory_id=?,folder_id=?,updated_at=? WHERE id=?').bind(category,factoryId||null,folderId,at,file.id).run();}",
"    else fail(400,'未知文件操作');",
"    await writeAuditQuietly(db,visitor,session,{method:'POST',action:'file.'+String(input.action),targetType:'file',targetId:file.id,targetName:file.original_filename,details:{category:file.category,factoryId:file.factory_id,folderId:file.folder_id}});return jsonResponse(request,200,{ok:true});",
"  }",
"  fail(404,'云盘操作不存在');",
"}",
"async function serveOfficeSource(request,env,rawToken){",
"  if(!env.FILES)fail(503,'云盘存储尚未配置');const digest=await sha256Hex(rawToken);",
"  const row=await env.DB.prepare('SELECT f.id,f.original_filename,f.extension,f.content_type,f.file_size,f.r2_key FROM office_preview_tokens t JOIN drive_files f ON f.id=t.file_id WHERE t.token_hash=? AND t.expires_at>? AND f.deleted_at IS NULL').bind(digest,Date.now()).first();",
"  if(!row)fail(404,'在线预览链接已失效，请重新打开文件');const obj=await env.FILES.get(row.r2_key);if(!obj)fail(404,'文件内容不存在');return streamDriveObject(request,obj,row,'inline');",
"}"
].join('\n');

h = once(h, 'async function handleApp(request, env, context) {', helpers + '\nasync function handleApp(request, env, context, visitor) {', 'insert visitor, audit, drive helpers');
h = once(h,
  "  if (route === '/healthz' && method === 'GET') {",
  "  const officeMatch = route.match(/^\\/api\\/office-source\\/([A-Za-z0-9_-]{43})$/);\n  if (officeMatch && (method === 'GET' || method === 'HEAD')) return await serveOfficeSource(request,env,officeMatch[1]);\n\n  if (route === '/healthz' && method === 'GET') {",
  'allow short-lived Office source links');

h = once(h,
  "  if (route === '/api/state' && method === 'GET') {\n    if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');\n    const body = { state:await readState(env.DB), session:publicSession(session), today:today(envTimeZone()), timeZone:envTimeZone() };",
  "  if (route === '/api/visitor-label' && method === 'POST') {\n    writeGuard(request,session); const input = await parseBody(request); const label = text(input.label,80);\n    if (Array.from(label).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) fail(400,'设备备注包含无效字符');\n    await env.DB.prepare('UPDATE visitors SET device_label=? WHERE visitor_id=?').bind(label,visitor?.visitorId||'UNKNOWN').run();\n    await writeAuditQuietly(env.DB,visitor,session,{method:'POST',action:'device.label',targetType:'visitor',targetId:visitor?.visitorId||'',targetName:label});\n    return jsonResponse(request,200,{ok:true,label});\n  }\n  if (route === '/api/audit' && method === 'POST') {\n    writeGuard(request,session); const input = await parseBody(request); const allowed = new Set(['page.view','factory.view','factory.search','factory.print','factory.export','factory.csv.export','backup.download','backup.restore']);\n    if (!allowed.has(input.action)) fail(400,'不支持的访问日志类型');\n    await writeAuditQuietly(env.DB,visitor,session,{method:'POST',action:input.action,targetType:text(input.targetType,40),targetId:text(input.targetId,120),targetName:text(input.targetName,240),details:{}});\n    return jsonResponse(request,200,{ok:true});\n  }\n  if (route === '/api/files' || route.startsWith('/api/files/')) return await handleDriveApi(request,env,session,visitor);\n\n  if (route === '/api/state' && method === 'GET') {\n    if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');\n    const body = { state:await readState(env.DB), session:publicSession(session), today:today(envTimeZone()), timeZone:envTimeZone(), visitor:visitor?{id:visitor.visitorId,label:visitor.deviceLabel}:null };",
  'add visitor label, audit and drive routes');
h = once(h, 'async function saveEdit(request, db, session, input) {', 'async function saveEdit(request, db, session, input, visitor) {', 'pass visitor context to data updates');

const tickBatch = '  const writeToken = token();\n  const batch = await db.batch([\n    db.prepare(\'UPDATE workspace SET payload=?,revision=?,write_token=? WHERE id=1 AND revision=?\').bind(packed, next.revision, writeToken, old.revision),\n    db.prepare(' + tick + 'INSERT INTO audit(at,user_id,action,target)\n      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND revision=? AND write_token=?)' + tick + ').bind(stamp(), session.userId, input.type, recordId, next.revision, writeToken)\n  ]);';
const newBatch = "  const writeToken = token();\n" +
"  const oldFactory = old.factories.find(f=>f.id===recordId) || old.factories.find(f=>f.id===input.id);\n" +
"  const newFactory = next.factories.find(f=>f.id===recordId) || next.factories.find(f=>f.id===input.id) || oldFactory;\n" +
"  const targetType = input.type === 'child.save' ? String(input.kind || 'record') : 'factory';\n" +
"  const targetName = newFactory?.name || oldFactory?.name || String(recordId);\n" +
"  const details = {};\n" +
"  if (input.type === 'factory.save' && newFactory) { const prior=old.factories.find(f=>f.id===recordId); const keys=[...factoryFields,'advantages']; const changed=keys.filter(k=>JSON.stringify(prior?.[k] ?? null)!==JSON.stringify(newFactory[k] ?? null)); details.changedFields=changed; details.before={}; details.after={}; for(const k of changed){details.before[k]=String(prior?.[k] ?? '').slice(0,180);details.after[k]=String(newFactory[k] ?? '').slice(0,180);} }\n" +
"  else if (input.type === 'child.save') details.kind = input.kind;\n" +
"  else if (['factory.delete','factory.restore','factory.purge'].includes(input.type) && oldFactory) { const nextStatus=input.type==='factory.delete'?'deleted':input.type==='factory.restore'?'active':'purged'; details.before={status:oldFactory.status||'active',name:oldFactory.name}; details.after={status:nextStatus}; }\n" +
"  let detailText = JSON.stringify(details); if (detailText.length>4500) detailText=JSON.stringify({truncated:true,changedFields:details.changedFields||[]}); const v=visitor||{};\n" +
"  const batch = await db.batch([\n" +
"    db.prepare('UPDATE workspace SET payload=?,revision=?,write_token=? WHERE id=1 AND revision=?').bind(packed,next.revision,writeToken,old.revision),\n" +
"    db.prepare(" + tick + "INSERT INTO audit(at,user_id,action,target) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND revision=? AND write_token=?)" + tick + ").bind(stamp(),session.userId,input.type,recordId,next.revision,writeToken),\n" +
"    db.prepare(" + tick + "INSERT INTO audit_events(at,visitor_id,user_id,ip,country,region,city,user_agent,browser,os,method,action,target_type,target_id,target_name,details,outcome,status_code) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND revision=? AND write_token=?)" + tick + ").bind(stamp(),v.visitorId||'UNKNOWN',session.userId,v.ip||'',v.country||'',v.region||'',v.city||'',v.userAgent||'',v.browser||'',v.os||'','POST',input.type,targetType,String(recordId),targetName,detailText,'success',200,next.revision,writeToken)\n" +
"  ]);";
h = once(h,tickBatch,newBatch,'write operation audit atomically with factory change');
h = once(h,"    return jsonResponse(request, 200, await saveEdit(request, env.DB, session, input));","    return jsonResponse(request, 200, await saveEdit(request, env.DB, session, input, visitor));",'pass visitor into data save');

const oldOnRequest = 'export async function onRequest(context) {';
const oi = h.indexOf(oldOnRequest);
if (oi < 0) throw new Error('onRequest function missing');
const newOnRequest = [
"export async function onRequest(context) {",
"  const { request, env } = context;",
"  let visitor = null, response;",
"  const route = new URL(request.url).pathname;",
"  try {",
"    if (route.startsWith('/api/') && !route.startsWith('/api/office-source/')) { await ensureSchema(env.DB); visitor = await ensureVisitor(request,env.DB); }",
"    response = await handleApp(request,env,context,visitor);",
"  } catch (e) {",
"    const known = e instanceof AppError, status = known ? e.status : 500;",
"    const message = known ? e.message : 'Server error; records unchanged / 服务器错误，资料未更改';",
"    if (!known) { const errorName=e instanceof Error?e.name:'UnknownError'; const errorMessage=String(e?.message||e||'Unknown error').replace(/[\\\\r\\\\n\\\\t]+/g,' ').slice(0,240); console.error('[yourz] Unhandled server exception',{route,method:request.method,errorName,errorMessage,stack:String(e?.stack||'').slice(0,1200)}); }",
"    if (visitor && route.startsWith('/api/')) { const action=route.startsWith('/api/files/upload')?'file.upload':route.startsWith('/api/files/replace')?'file.replace':route.startsWith('/api/files/download')?'file.download':route.startsWith('/api/files/preview')?'file.preview':route.startsWith('/api/action')?'data.change':'api.request'; await writeAuditQuietly(env.DB,visitor,null,{method:request.method,action,targetType:'route',targetId:route,outcome:'failed',statusCode:status,details:{code:known?(e.code||'error'):'error',message:message.slice(0,180)}}); }",
"    response = jsonResponse(request,status,{error:message,code:known?(e.code||'error'):'error'});",
"  }",
"  const headers = new Headers(response.headers); securityHeaders(headers,new URL(request.url).origin);",
"  if (visitor?.setCookie) headers.append('Set-Cookie',visitor.setCookie);",
"  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});",
"}"
].join('\n');
h = h.slice(0,oi) + newOnRequest;

h = once(h,
  "headers.set('Content-Security-Policy', \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\");",
  "headers.set('Content-Security-Policy', \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://view.officeapps.live.com; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'\");",
  'allow same-site and Office viewer preview iframes');
write('src/handler.js',h);
console.log('Added R2 file APIs, visitor metadata, Office viewer tokens, and audit writes.');
