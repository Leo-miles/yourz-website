import fs from 'node:fs';
const root = process.argv[2] || 'app';
const read = p => fs.readFileSync(root + '/' + p, 'utf8');
const write = (p, s) => fs.writeFileSync(root + '/' + p, s);
function once(source,before,after,label){if(!source.includes(before))throw new Error('Patch target missing: '+label);return source.replace(before,after);}
const tick=String.fromCharCode(96), dollar=String.fromCharCode(36);

let i=read('public/index.html');
i=once(i,'<button id="signout" hidden>Sign out / 退出</button>','<button id="signout" hidden>Sign out / 退出</button><button id="devicebtn" hidden>设备备注</button>','add device-label button');
i=once(i,'<button data-view="guide">Guide &amp; files / 说明与文件</button>','<button data-view="guide">Guide &amp; files / 说明与文件</button><button data-view="drive">云盘 / 文档中心</button>','add drive navigation');
write('public/index.html',i);

let css=read('public/style.css');
css += '\n.drive-preview-frame{width:100%;height:min(72vh,780px);min-height:480px;border:1px solid var(--line);border-radius:8px;background:white}.drive-note{border:1px solid #c7a45b;background:#fff6de;border-radius:8px;padding:12px;margin:12px 0 18px}.drive-meta{font-size:12px;color:var(--muted);margin-top:4px}.drive-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.drive-toolbar select,.drive-toolbar input{border:1px solid #8fa7b7;border-radius:8px;background:#fff;padding:10px;min-width:150px}.drive-file-actions{display:flex;gap:5px;flex-wrap:wrap}.drive-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px}\n@media(max-width:700px){.drive-preview-frame{min-height:360px}.drive-toolbar select,.drive-toolbar input{min-width:0;flex:1}}\n';
write('public/style.css',css);

let a=read('public/app.js');
a=once(a,
  "let session=null,busy=false,teamData=null,serverDay='',timeZone='Asia/Shanghai';",
  "let session=null,busy=false,teamData=null,serverDay='',timeZone='Asia/Shanghai';\n let visitorInfo=null,initialPageLogged=false,driveData=null,driveFolders=[],driveError='',driveQuery='',driveCategory='all',driveFolder='all',driveFactory='all',driveTrash=false,drivePage=1,drivePageSize=50,searchAuditTimer=null,lastSearchAudit='',driveReplaceTarget='';",
  'add client visitor and drive state');
a=once(a,
  'session=data.session;serverDay=data.today;timeZone=data.timeZone;stale=false;updateAccess();render();',
  "session=data.session;visitorInfo=data.visitor||visitorInfo;serverDay=data.today;timeZone=data.timeZone;stale=false;updateAccess();render();if(!initialPageLogged){initialPageLogged=true;recordClientAudit('page.view','page',view,'首次访问');}",
  'capture visitor ID on refresh');
a=once(a,
  "function updateAccess(){if(!isAdmin()){teamData=null;if(view==='team')view='factories';}document.getElementById('newfactory').hidden=!canEdit();document.getElementById('backup').hidden=!session;document.querySelector('[data-view=\"team\"]').hidden=true;document.getElementById('signout').hidden=true;document.getElementById('refresh').hidden=!session;}",
  "function updateAccess(){if(!isAdmin()){teamData=null;if(view==='team')view='factories';}document.getElementById('newfactory').hidden=!canEdit();document.getElementById('backup').hidden=!session;document.querySelector('[data-view=\"team\"]').hidden=true;document.getElementById('signout').hidden=true;document.getElementById('refresh').hidden=!session;document.getElementById('devicebtn').hidden=!session;document.getElementById('devicebtn').textContent=visitorInfo&&visitorInfo.label?'设备：'+visitorInfo.label:'设备备注';}",
  'display device label');

const driveCode = [
" const DRIVE_CATEGORY_LABEL={quote:'报价单 / Quote',spec:'规格书 / Specification',certificate:'认证证书 / Certificate',catalog:'产品目录 / Product catalog',packaging:'包装文件 / Packaging',other:'其他资料 / Other'};",
" function driveOption(value,labelText,selectedValue){return '<option value=\"'+esc(value)+'\"'+(String(value)===String(selectedValue)?' selected':'')+'>'+esc(labelText)+'</option>';}",
" function driveSize(n){if(!Number.isFinite(Number(n)))return '—';var b=Number(n);return b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB';}",
" async function recordClientAudit(action,targetType,targetId,targetName){try{if(session)await api('/api/audit',{method:'POST',body:{action,targetType:targetType||'',targetId:targetId||'',targetName:targetName||''}});}catch{}}",
" async function loadDrive(){",
"  try{driveError='';const folderResult=await api('/api/files/folders');driveFolders=folderResult.folders||[];const p=new URLSearchParams({page:String(drivePage),pageSize:String(drivePageSize),trash:driveTrash?'1':'0'});if(driveQuery)p.set('q',driveQuery);if(driveCategory!=='all')p.set('category',driveCategory);if(driveFactory!=='all')p.set('factoryId',driveFactory);if(driveFolder!=='all')p.set('folderId',driveFolder);driveData=await api('/api/files?'+p.toString());",
"  }catch(e){driveError=e.message;driveData={files:[],total:0,page:drivePage,pageSize:drivePageSize,trash:driveTrash};}if(view==='drive')render();",
" }",
" function drive(){",
"  const files=driveData&&driveData.files||[],total=driveData&&driveData.total||0;",
"  const factories=active().map(f=>driveOption(f.id,f.name+' · '+f.id,driveFactory)).join('');",
"  const folders=driveFolders.map(f=>driveOption(f.id,f.name,driveFolder)).join('');",
"  const cats=Object.keys(DRIVE_CATEGORY_LABEL).map(k=>driveOption(k,DRIVE_CATEGORY_LABEL[k],driveCategory)).join('');",
"  const rows=files.map(f=>{const factory=state.factories.find(x=>x.id===f.factory_id);const folder=driveFolders.find(x=>x.id===f.folder_id);const act=f.deleted_at?button('file-restore',f.id,'恢复 / Restore'):button('file-preview',f.id,'预览 / Preview')+button('file-download',f.id,'下载 / Download')+button('file-replace',f.id,'替换 / Replace')+button('file-meta',f.id,'归档 / Organize')+button('file-rename',f.id,'重命名 / Rename')+button('file-versions',f.id,'版本 / Versions')+button('file-delete',f.id,'删除 / Trash','small danger');return '<tr><td><strong>'+esc(f.original_filename)+'</strong><div class=drive-meta>'+esc(f.extension.toUpperCase())+' · '+driveSize(f.file_size)+' · v'+esc(f.current_version)+'</div></td><td>'+esc(DRIVE_CATEGORY_LABEL[f.category]||f.category)+'</td><td>'+esc(factory?factory.name:(f.factory_id||'—'))+'</td><td>'+esc(folder?folder.name:'根目录 / Root')+'</td><td>'+esc(f.uploaded_by||'—')+'<div class=drive-meta>'+esc((f.uploaded_at||'').replace('T',' ').slice(0,16))+'</div></td><td><div class=drive-file-actions>'+act+'</div></td></tr>';}).join('');",
"  const listing=files.length?'<div class=tablewrap><table><thead><tr><th>文件 / File</th><th>分类 / Category</th><th>关联工厂 / Factory</th><th>文件夹 / Folder</th><th>上传信息 / Uploaded</th><th>操作 / Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class=empty><h2>'+(driveError?'云盘暂不可用 / Drive unavailable':driveQuery?'没有匹配文件 / No matching files':driveTrash?'回收站为空 / Trash is empty':'暂无文件 / No files yet')+'</h2><p>'+esc(driveError||'上传的文件会保存在云端，团队可从其他电脑访问。')+'</p></div>';",
"  const pageCount=Math.max(1,Math.ceil(total/drivePageSize));",
"  return '<div class=heading><div><h1>'+(driveTrash?'云盘回收站 / Drive trash':'YOURZ 云盘 / Document center')+'</h1><p class=sub>云端统一存储 · 多电脑共享 · 上传与操作留痕 / Cloud storage, team access and audit history</p></div><div class=actions><button class=primary data-act=drive-upload>上传文件 / Upload</button><button data-act=drive-folder-new>新建文件夹 / New folder</button><button data-act=drive-toggle-trash>'+(driveTrash?'返回文件 / All files':'回收站 / Trash')+'</button></div></div>' +",
"  '<div class=drive-note>访问留痕说明：网站会记录匿名访客编号、IP 地址及其大致地区、浏览器/系统信息，以及访问和文件操作记录；地区是 IP 推算结果，并非 GPS。 / Audit notice: visitor ID, IP and approximate IP-based location, browser/system information, and page/file actions are recorded.</div><div class=drive-note>Office 在线预览通过 Microsoft Office Online Viewer 渲染。点击预览时，系统生成仅可读取、15分钟后失效的临时链接；预览服务可在有效期内读取该文件。敏感文件请先下载，或不要使用 Office 在线预览。PDF 和常见图片由本网站直接预览。</div>' +",
"  (driveError?'<div class=notice error>'+esc(driveError)+'</div>':'') +",
"  '<div class=panel><div class=drive-toolbar><input id=drivesearch type=search placeholder=\"输入文件名，按回车搜索 / Search filename\" value=\"'+esc(driveQuery)+'\"><select id=drivecategory aria-label=分类>'+driveOption('all','全部分类 / All categories',driveCategory)+cats+'</select><select id=drivefactory aria-label=工厂>'+driveOption('all','全部工厂 / All factories',driveFactory)+factories+'</select><select id=drivefolder aria-label=文件夹>'+driveOption('all','全部文件夹 / All folders',driveFolder)+driveOption('root','根目录 / Root',driveFolder)+folders+'</select></div>' +",
"  '<div class=sub>支持 DOC、DOCX、XLS、XLSX、PPT、PPTX、PDF、CSV、TXT 和常见图片；单个文件目前限25MB。/ Supports Office, PDF, text and common images; 25MB maximum per file.</div></div>' + listing +",
"  '<div class=drive-pagination><span class=sub>共 '+total+' 份文件 · 第 '+drivePage+' / '+pageCount+' 页</span><div class=actions><button data-act=drive-page-prev '+(drivePage<=1?'disabled':'')+'>上一页</button><button data-act=drive-page-next '+(drivePage>=pageCount?'disabled':'')+'>下一页</button></div></div>' +",
"  '<input id=driveupload type=file multiple accept=\".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif\" hidden>';",
" }",
" async function uploadDriveFiles(files){",
"  const list=Array.from(files||[]);if(!list.length)return;const factoryId=driveFactory==='all'?'':driveFactory,folderId=driveFolder==='all'||driveFolder==='root'?'':driveFolder,category=driveCategory==='all'?'other':driveCategory;let done=0;",
"  for(const file of list){if(file.size>25*1024*1024){toast(file.name+' 超过25MB，已跳过');continue;}const p=new URLSearchParams({category});if(factoryId)p.set('factoryId',factoryId);if(folderId)p.set('folderId',folderId);",
"   let response,data;try{response=await fetch('/api/files/upload?'+p.toString(),{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':session?.csrf||'','X-File-Name':encodeURIComponent(file.name)},body:file});data=await response.json();}catch{throw Error('上传连接失败，请检查网络后重试');}if(!response.ok)throw Error(data.error||'上传失败：'+file.name);done++;",
"  }toast('上传完成：'+done+' 份文件');drivePage=1;await loadDrive();",
" }",
" async function previewDriveFile(id){",
"  const file=(driveData?.files||[]).find(x=>x.id===id);if(!file)throw Error('请刷新文件列表后重试');",
"  const office=['doc','docx','xls','xlsx','ppt','pptx'].includes(file.extension);",
"  const contents='<p class=sub>'+esc(file.original_filename)+' · '+esc(DRIVE_CATEGORY_LABEL[file.category]||file.category)+'</p><iframe class=drive-preview-frame src=about:blank title=文件预览></iframe>'+(office?'<p class=sub>由 Microsoft Office Online Viewer 在线渲染。链接15分钟后失效。</p>':'');",
"  openModal('在线预览 / Preview',contents,async()=>{},'<button type=button id=closefilepreview>关闭 / Close</button>');document.getElementById('closefilepreview').onclick=()=>{dirty=false;modal.close();};",
"  const frame=modal.querySelector('iframe');if(office){const info=await api('/api/files/preview-token',{method:'POST',body:{id}});frame.src='https://view.officeapps.live.com/op/view.aspx?src='+encodeURIComponent(info.url);}else frame.src='/api/files/preview?id='+encodeURIComponent(id);",
" }",
" async function replaceDriveFile(id,file){if(!file)return;const existing=(driveData?.files||[]).find(x=>x.id===id);if(!existing)return;const ext=String(file.name||'').split('.').pop().toLowerCase();if(ext!==existing.extension)throw Error('替换文件必须与原文件使用相同格式');if(file.size>25*1024*1024)throw Error('单个文件暂限25MB');if(!confirm('用 '+file.name+' 替换当前文件，并保留旧版本？'))return;let response,data;try{response=await fetch('/api/files/replace?id='+encodeURIComponent(id),{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':session?.csrf||'','X-File-Name':encodeURIComponent(file.name)},body:file});data=await response.json();}catch{throw Error('替换连接失败，请检查网络后重试');}if(!response.ok)throw Error(data.error||'替换失败');toast('文件已替换，历史版本已保留');await loadDrive();}",
" async function renameDriveFile(id){const file=(driveData?.files||[]).find(x=>x.id===id);if(!file)return;const name=prompt('输入新的文件名（必须保留 .'+file.extension+' 扩展名）',file.original_filename);if(name===null)return;await api('/api/files/action',{method:'POST',body:{action:'rename',id,name}});toast('文件名已更新');await loadDrive();}",
" async function editDriveMeta(id){const file=(driveData?.files||[]).find(x=>x.id===id);if(!file)return;const factoryOpts='<option value=\"\">不关联工厂 / None</option>'+active().map(f=>'<option value=\"'+esc(f.id)+'\" '+(f.id===file.factory_id?'selected':'')+'>'+esc(f.name)+' · '+esc(f.id)+'</option>').join('');const folderOpts='<option value=\"\">根目录 / Root</option>'+driveFolders.map(f=>'<option value=\"'+esc(f.id)+'\" '+(f.id===file.folder_id?'selected':'')+'>'+esc(f.name)+'</option>').join('');const catOpts=Object.keys(DRIVE_CATEGORY_LABEL).map(k=>'<option value=\"'+k+'\" '+(k===file.category?'selected':'')+'>'+esc(DRIVE_CATEGORY_LABEL[k])+'</option>').join('');",
"  openModal('编辑文件归档 / Organize file','<div class=grid><label class=field><span>资料分类 / Category</span><select name=category>'+catOpts+'</select></label><label class=field><span>关联工厂 / Factory</span><select name=factoryId>'+factoryOpts+'</select></label><label class=\"field wide\"><span>文件夹 / Folder</span><select name=folderId>'+folderOpts+'</select></label></div>',async fd=>{await api('/api/files/action',{method:'POST',body:{action:'meta',id,category:fd.get('category'),factoryId:fd.get('factoryId'),folderId:fd.get('folderId')}});dirty=false;modal.close();toast('文件归档已更新');await loadDrive();},'<button type=submit class=primary>保存 / Save</button>');",
" }",
" async function showDriveVersions(id){const data=await api('/api/files/versions?id='+encodeURIComponent(id));const rows=(data.versions||[]).map(v=>'<tr><td>v'+esc(v.version_no)+(Number(v.version_no)===Number(data.file.current_version)?'（当前）':'')+'</td><td>'+esc(v.original_filename)+'</td><td>'+driveSize(v.file_size)+'</td><td>'+esc((v.created_at||'').replace('T',' ').slice(0,16))+'</td><td>'+(Number(v.version_no)===Number(data.file.current_version)?'—':'<button type=button class=small data-version-restore=\"'+esc(v.version_no)+'\">恢复此版本</button>')+'</td></tr>').join('');",
"  openModal('历史版本 / Versions','<div class=tablewrap><table><thead><tr><th>版本</th><th>文件名</th><th>大小</th><th>时间</th><th>操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>',async()=>{},'<button type=button id=closeversions>关闭 / Close</button>');document.getElementById('closeversions').onclick=()=>{dirty=false;modal.close();};",
"  modal.querySelectorAll('[data-version-restore]').forEach(b=>b.onclick=async()=>{if(!confirm('确定将当前文件恢复到 v'+b.dataset.versionRestore+'？'))return;try{await api('/api/files/restore-version',{method:'POST',body:{id,version:Number(b.dataset.versionRestore)}});dirty=false;modal.close();toast('文件版本已恢复');await loadDrive();}catch(e){toast(e.message);}});",
" }",
" async function deleteDriveFile(id){const f=(driveData?.files||[]).find(x=>x.id===id);if(!f||!confirm('将 '+f.original_filename+' 移入云盘回收站？文件内容将暂时保留，可恢复。'))return;await api('/api/files/action',{method:'POST',body:{action:'delete',id}});toast('文件已移入回收站');await loadDrive();}",
" async function restoreDriveFile(id){await api('/api/files/action',{method:'POST',body:{action:'restore',id}});toast('文件已恢复');await loadDrive();}",
" async function newDriveFolder(){const name=prompt('输入新文件夹名称');if(name===null||!name.trim())return;await api('/api/files/folders',{method:'POST',body:{name:name.trim()}});toast('文件夹已创建');await loadDrive();}"
].join('\n');

a=once(a," function guide(){",driveCode+"\n function guide(){",'insert cloud drive client');
a=once(a,
  "let content=selected?profile(selected):view==='factories'?list():view==='trash'?list(true):view==='followups'?followups():view==='team'?team():guide();",
  "let content=selected?profile(selected):view==='drive'?drive():view==='factories'?list():view==='trash'?list(true):view==='followups'?followups():view==='team'?team():guide();",
  'render drive view');
const fullButton = dollar + "{button('full',id,'Export full profile / 导出完整档案')}";
const relatedButton = fullButton + ' ' + dollar + "{button('factory-docs',id,'相关文件 / Related files')}";
a=once(a,fullButton,relatedButton,'add related files button on factory profile');

a=once(a,
  "case'open':selected=id;render();break;",
  "case'open':selected=id;render();recordClientAudit('factory.view','factory',id,get(id)?.name||id);break;case'factory-docs':driveFactory=id;driveFolder='all';driveTrash=false;drivePage=1;selected='';view='drive';render();loadDrive();break;case'drive-upload':{const inp=document.getElementById('driveupload');if(inp){driveReplaceTarget='';inp.multiple=true;inp.click();}break;}case'file-replace':{const inp=document.getElementById('driveupload');if(inp){driveReplaceTarget=id;inp.multiple=false;inp.value='';inp.click();}break;}case'drive-folder-new':await newDriveFolder();break;case'drive-toggle-trash':driveTrash=!driveTrash;drivePage=1;await loadDrive();break;case'drive-page-prev':drivePage=Math.max(1,drivePage-1);await loadDrive();break;case'drive-page-next':drivePage=drivePage+1;await loadDrive();break;case'file-preview':await previewDriveFile(id);break;case'file-download':{const link=document.createElement('a');link.href='/api/files/download?id='+encodeURIComponent(id);link.rel='noopener';document.body.append(link);link.click();link.remove();break;}case'file-rename':await renameDriveFile(id);break;case'file-meta':await editDriveMeta(id);break;case'file-delete':await deleteDriveFile(id);break;case'file-restore':await restoreDriveFile(id);break;case'file-versions':await showDriveVersions(id);break;",
  'wire drive actions');
a=once(a,
  "case'print':printProfile(id);break;case'full':fullProfile(id);break;case'backup':await backup();break;case'import':document.getElementById('restorefile').click();break;case'csv':exportCSV(document.getElementById('csvkind').value);break;",
  "case'print':recordClientAudit('factory.print','factory',id,get(id)?.name||id);printProfile(id);break;case'full':recordClientAudit('factory.export','factory',id,get(id)?.name||id);fullProfile(id);break;case'backup':await recordClientAudit('backup.download','backup','','Full database backup');await backup();break;case'import':recordClientAudit('backup.restore','backup','','Restore from backup');document.getElementById('restorefile').click();break;case'csv':recordClientAudit('factory.csv.export','factory','',document.getElementById('csvkind').value);exportCSV(document.getElementById('csvkind').value);break;",
  'audit backup, export and print actions');
a=once(a,
  "document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;selected='';query='';render();if(view==='team')loadTeam().catch(e=>toast(e.message));});",
  "document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;selected='';query='';render();recordClientAudit('page.view','page',view,b.textContent||view);if(view==='team')loadTeam().catch(e=>toast(e.message));if(view==='drive')loadDrive();});",
  'wire navigation visits');
const eventInsert = [
" main.addEventListener('keydown',e=>{if(e.target?.id==='drivesearch'&&e.key==='Enter'){e.preventDefault();driveQuery=e.target.value.trim();drivePage=1;loadDrive();}});",
" main.addEventListener('change',async e=>{",
"  try{if(e.target?.id==='driveupload'){const files=Array.from(e.target.files||[]);e.target.value='';if(driveReplaceTarget){const id=driveReplaceTarget;driveReplaceTarget='';e.target.multiple=true;if(files[0])await replaceDriveFile(id,files[0]);}else{e.target.multiple=true;await uploadDriveFiles(files);}}",
"  else if(e.target?.id==='drivecategory'){driveCategory=e.target.value;drivePage=1;await loadDrive();}",
"  else if(e.target?.id==='drivefactory'){driveFactory=e.target.value;drivePage=1;await loadDrive();}",
"  else if(e.target?.id==='drivefolder'){driveFolder=e.target.value;drivePage=1;await loadDrive();}}catch(err){toast(err.message);}",
" });",
" document.getElementById('devicebtn').onclick=async()=>{const current=visitorInfo?.label||'';const label=prompt('给这台浏览器取个备注名，例如“义乌办公室-采购电脑01”。这是可编辑备注，并不是系统验证的真实电脑名。',current);if(label===null)return;try{const data=await api('/api/visitor-label',{method:'POST',body:{label:label.trim()}});visitorInfo={...(visitorInfo||{}),label:data.label};updateAccess();toast('设备备注已保存');}catch(err){toast(err.message);}};"
].join('\n')+'\n';
a=once(a," main.addEventListener('submit',async e=>{",eventInsert+" main.addEventListener('submit',async e=>{",'add drive upload and device handlers');

a=once(a,
  " function render(){if(!session){renderLogin();return;}if(selected&&!state.factories.some(f=>f.id===selected))selected='';storageBadge();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));let content=selected?profile(selected):view==='drive'?drive():view==='factories'?list():view==='trash'?list(true):view==='followups'?followups():view==='team'?team():guide();main.innerHTML=banner()+content;const search=document.getElementById('search');if(search)search.oninput=()=>{const pos=search.selectionStart;query=search.value;render();const n=document.getElementById('search');n.focus();n.setSelectionRange(pos,pos);};}",
  " function render(){if(!session){renderLogin();return;}if(selected&&!state.factories.some(f=>f.id===selected))selected='';storageBadge();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));let content=selected?profile(selected):view==='drive'?drive():view==='factories'?list():view==='trash'?list(true):view==='followups'?followups():view==='team'?team():guide();main.innerHTML=banner()+content;const search=document.getElementById('search');if(search)search.oninput=()=>{const pos=search.selectionStart;query=search.value;render();const n=document.getElementById('search');n.focus();n.setSelectionRange(pos,pos);};}",
  'keep rendered drive routing consistent');
a=once(a, " function render(){if(!session){renderLogin();return;}if(selected&&!state.factories.some(f=>f.id===selected))selected='';storageBadge();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));let content=selected?profile(selected):view==='drive'?drive():view==='factories'?list():view==='trash'?list(true):view==='followups'?followups():view==='team'?team():guide();main.innerHTML=banner()+content;const search=document.getElementById('search');if(search)search.oninput=()=>{const pos=search.selectionStart;query=search.value;render();const n=document.getElementById('search');n.focus();n.setSelectionRange(pos,pos);};}", " function render(){if(!session){renderLogin();return;}if(selected&&!state.factories.some(f=>f.id===selected))selected='';storageBadge();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));let content=selected?profile(selected):view==='drive'?drive():view==='factories'?list():view==='trash'?list(true):view==='followups'?followups():view==='team'?team():guide();main.innerHTML=banner()+content;const search=document.getElementById('search');if(search)search.oninput=()=>{const pos=search.selectionStart;query=search.value;const searchText=query.trim();clearTimeout(searchAuditTimer);if(searchText.length>=2&&searchText!==lastSearchAudit){searchAuditTimer=setTimeout(()=>{if(searchText!==lastSearchAudit){lastSearchAudit=searchText;recordClientAudit('factory.search','factory-search','',searchText);}},700);}if(!searchText)lastSearchAudit='';render();const n=document.getElementById('search');n.focus();n.setSelectionRange(pos,pos);};}", 'debounce and record factory search');
write('public/app.js',a);
console.log('Added cloud drive UI, Office viewer modal, factory-linked documents, and device label UI.');
