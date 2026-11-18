'use strict';
const $ = s => document.querySelector(s);
const state = {token:'', defaults:null, doc:null, rows:[], roles:new Map(), reasons:new Map(), epoch:0, ai:null, providerReady:false, models:[], connectionVersion:0,limits:{file_mb:32,preview_mb:32},revision:0,converted:false,previewJobs:new Map(),viewers:{},editedRequests:new Map()};
const roleNames = {body:'正文',heading1:'章標題',heading2:'節標題',heading3:'小節標題',heading4:'次小節標題',keep:'保留原樣'};
state.needsReview=new Set();state.overrides=new Set();
const fields = [
 ['chinese_font','中文字型','text',null,null,true],['latin_font','英文字型','text',null,null,true],
 ['body_size','正文（pt）','number',6,72],['first_line_chars','首行縮排（字）','number',0,10],
 ['heading1','章標題（pt）','number',6,72],['heading2','節標題（pt）','number',6,72],
 ['heading3','小節（pt）','number',6,72],['heading4','次小節（pt）','number',6,72],
 ['line_spacing','行距（倍）','number',.5,3],['paragraph_after','段後（pt）','number',0,72],
 ['top','上邊界（cm）','number',.5,5],['bottom','下邊界（cm）','number',.5,5],
 ['left','左邊界（cm）','number',.5,5],['right','右邊界（cm）','number',.5,5]
];
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function notice(text,error=false){$('#notice').textContent=text;$('#notice').hidden=!text;$('#notice').dataset.error=String(error);}
function connectionStatus(status,description){
 const names={ollama:'Ollama',openai:'OpenAI',compatible:'本機相容服務'};
 $('#connection').dataset.state=status;
 $('#connection-label').textContent=`${names[$('#provider').value]} · ${$('#model').value.trim()||'未選擇模型'}`;
 const label={ready:'綠燈',pending:'橙燈',error:'紅燈'}[status];
 $('#connection-tooltip').textContent=description;
 $('#model-indicator').setAttribute('aria-label',$('#connection-label').textContent+'，'+label+'，'+description);
}
function modelSelectionStatus(){
 const selected=$('#model').value.trim();
 if(!state.providerReady)connectionStatus('pending','尚未連接模型');
 else if(!selected)connectionStatus('pending','尚未選擇模型');
 else if(state.models.includes(selected))connectionStatus('ready','模型已連接');
 else connectionStatus('pending','尚未確認模型');
}
function selectPanel(id){for(const panel of document.querySelectorAll('.settings-content > details'))panel.open=panel.id===id;for(const button of document.querySelectorAll('[data-panel]'))button.setAttribute('aria-pressed',String(button.dataset.panel===id));}
function toggleSettings(open,panel){$('#settings-panel').hidden=!open;$('.workbench').classList.toggle('settings-open',open);$('#toggle-settings').setAttribute('aria-expanded',String(open));if(panel)selectPanel(panel);}
function selectView(side){$('.preview-columns').dataset.view=side;for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===side));}
function updateViewer(side,values){
 state.viewers[side]={...state.viewers[side],...values};
}
function invalidatePreview(){state.revision++;if(state.converted)$('#converted-state').textContent='設定已變更';$('#download-edited').hidden=true;$('#export').disabled=true;}
function exportBody(){return {profile:profile(),selections:[...state.roles].map(([paragraph_id,role])=>({paragraph_id,role})),clean_leading:$('#clean-leading').checked};}
function clearPreviews(){for(const task of state.previewJobs.values()){clearTimeout(task.timer);task.resolve(false);}state.previewJobs.clear();for(const task of state.editedRequests.values()){clearTimeout(task.timer);task.reject(new Error('文件已清除。'));}state.editedRequests.clear();for(const side of ['original','converted']){updateViewer(side,{job:null,page:1,total:0});$('#'+side+'-preview').hidden=true;$('#'+side+'-preview').src='about:blank';$('#'+side+'-placeholder').hidden=false;$('#'+side+'-placeholder').textContent=side==='original'?'選取文件後顯示預覽':'轉換後顯示預覽';}state.converted=false;$('#converted-state').textContent='尚未轉換';}
function showPreview(side,blob){
 const frame=$('#'+side+'-preview'),placeholder=$('#'+side+'-placeholder');
 updateViewer(side,{job:null,page:1,total:0});
 placeholder.hidden=false;frame.hidden=true;
 if(blob.size>state.limits.preview_mb*1024*1024){placeholder.textContent='文件較大，請下載後檢視';return Promise.resolve(false);}
 placeholder.textContent='正在產生預覽…';
 for(const [id,task]of state.previewJobs){if(task.side===side){clearTimeout(task.timer);task.resolve(false);state.previewJobs.delete(id);}}
 const job=crypto.randomUUID();updateViewer(side,{job,page:1,total:0});return new Promise(resolve=>{const timer=setTimeout(()=>{state.previewJobs.delete(job);placeholder.textContent='預覽逾時，仍可下載文件';resolve(false);},120000);state.previewJobs.set(job,{side,blob,resolve,timer,sent:false});frame.src='/static/preview.html?job='+job+'&mode='+(side==='converted'?'editor':'viewer');});
}
window.addEventListener('message',async event=>{
 if(['edited-bytes','edited-export-error'].includes(event.data?.type)){
  const request=state.editedRequests.get(event.data.requestId);if(!request||event.source!==$('#converted-preview').contentWindow||event.data.job!==state.viewers.converted?.job)return;
  clearTimeout(request.timer);state.editedRequests.delete(event.data.requestId);
  if(event.data.type==='edited-bytes'&&event.data.buffer instanceof ArrayBuffer)request.resolve(event.data.buffer);else request.reject(new Error('編輯後文件匯出失敗。'));
  return;
 }
 if(event.data?.type==='preview-state'){
  for(const side of ['original','converted'])if(event.source===$('#'+side+'-preview').contentWindow&&state.viewers[side]?.job===event.data.job&&Number.isInteger(event.data.total)&&event.data.total>0&&Number.isInteger(event.data.page)&&event.data.page>=1&&event.data.page<=event.data.total)updateViewer(side,{page:event.data.page,total:event.data.total});
  return;
 }
 const task=state.previewJobs.get(event.data?.job);if(!task)return;
 const frame=$('#'+task.side+'-preview');if(event.source!==frame.contentWindow)return;
 if(event.data.type==='preview-ready'&&!task.sent){task.sent=true;const buffer=await task.blob.arrayBuffer();if(!state.previewJobs.has(event.data.job))return;frame.contentWindow.postMessage({type:'render-docx',job:event.data.job,buffer},'*',[buffer]);}
 else if(['preview-rendered','preview-error'].includes(event.data.type)){
  clearTimeout(task.timer);state.previewJobs.delete(event.data.job);const ok=event.data.type==='preview-rendered';frame.hidden=!ok;$('#'+task.side+'-placeholder').hidden=ok;
  if(!ok)$('#'+task.side+'-placeholder').textContent='無法預覽此文件，仍可下載檢視';else updateViewer(task.side,{page:1,total:event.data.total||1});task.resolve(ok);
 }
});
function detailError(data){if(typeof data.detail==='string')return data.detail;if(Array.isArray(data.detail))return '格式設定不合法：'+data.detail.map(x=>x.loc.slice(-1)+': '+x.msg).join('；');return '請求失敗，請重試。';}
async function api(path,options={}){
 const headers={'X-PoW-Token':state.token,...options.headers};
 if(options.json){headers['Content-Type']='application/json';options.body=JSON.stringify(options.json);delete options.json;}
 const response=await fetch('/api'+path,{...options,headers});
 if(!response.ok){let data;try{data=await response.json();}catch{data={detail:'本機服務未回應，請確認仍在執行。'};}throw new Error(detailError(data));}
 return response;
}
function setProfile(profile){if(state.ai)cancelAI();invalidatePreview();for(const [k,v] of Object.entries(profile)){const e=$(`[name="${k}"]`);if(e){if(e.type==='checkbox')e.checked=v;else e.value=v;}}render();}
function profile(){if(!$('#profile-form').checkValidity()){toggleSettings(true,'profile-settings');$('#advanced-format').open=true;$('#profile-form').reportValidity();throw new Error('請先修正格式規格的欄位。');}const p={};for(const [k,,type] of fields)p[k]=type==='number'?Number($(`[name="${k}"]`).value):$(`[name="${k}"]`).value.trim();p.alignment=$('[name=alignment]').value;p.new_page_chapters=$('[name=new_page_chapters]').checked;return p;}
function formatText(r){return r.formats.map(f=>`${f.chinese_font} / ${f.latin_font}，${f.size} pt${f.bold?'，粗體':''}`).join('；')||'未包含一般文字';}
function differences(r,p,role){
 if(role==='keep'||!r.editable)return ['保留原樣'+(r.skip_reason?'：'+r.skip_reason:'')];
 const heading=role.startsWith('heading'),size=heading?p[role]:p.body_size,out=[];
 if(r.formats.some(f=>f.chinese_font!==p.chinese_font||f.latin_font!==p.latin_font))out.push(`字型改為 ${p.chinese_font} / ${p.latin_font}`);
 if(r.formats.some(f=>f.size!==size))out.push(`字級改為 ${size} pt`);
 if(heading&&r.formats.some(f=>!f.bold))out.push('標題加粗');
 const align=heading?'left':p.alignment;if(r.alignment!==align)out.push('調整段落對齊');
 if(!r.numbered_heading&&(heading?0:p.first_line_chars)!==r.first_line_chars)out.push(`首行縮排 ${heading?0:p.first_line_chars} 字`);
 if(!r.numbered_heading&&(r.left_indent_pt||r.right_indent_pt))out.push('清除左右段落縮排');
 if(r.line_spacing!==p.line_spacing)out.push(`行距 ${p.line_spacing} 倍`);
 if($('#clean-leading').checked&&!heading&&r.leading)out.push(`移除 ${r.leading} 個段首空白／Tab`);
 if(r.space_before!==(heading&&role!=='heading1'?size:0)||r.space_after!==(role==='heading1'?size:p.paragraph_after))out.push('調整段前與段後間距');
 if(r.outline_level!==(heading?Number(role.slice(-1))-1:9))out.push('設定段落大綱層級');
 if(!r.page_break_before&&role==='heading1'&&p.new_page_chapters&&r.id!=='p-1')out.push('章標題從新頁開始');
 return out;
}
function render(){
 if(!state.defaults)return;
 let p;try{p=profileUnchecked();}catch{return;}
 const box=$('#paragraphs');box.replaceChildren();const filter=$('#filter').value;
 $('#empty').hidden=!!state.doc;$('#ai-tools').hidden=!state.doc;
 $('#inspect-paragraphs').hidden=!state.doc;
 $('#inspect-paragraphs').textContent=state.needsReview.size?`檢查（${state.needsReview.size}）`:'檢查';
 $('#inspect-paragraphs').title=`${state.needsReview.size} 段待確認`;
 $('#counts').textContent=state.doc?`${state.rows.length} 段，${state.rows.filter(r=>!r.editable).length} 段略過`:'尚未載入文件';
 for(const r of state.rows){
  const role=state.roles.get(r.id)||'keep',diff=differences(r,p,role);
  if(filter==='review'&&!state.needsReview.has(r.id))continue;
  if(filter==='keep'&&role!=='keep'&&r.editable)continue;
  if(filter==='changed'&&(role==='keep'||!r.editable||!diff.length))continue;
  const title=`第 ${Number(r.id.slice(2))} 段`;
  const article=node('article',undefined,'paragraph');const h=node('div',undefined,'paragraph-head');h.append(node('strong',title));
  const label=node('label','角色');const select=node('select');select.setAttribute('aria-label',title+'角色');select.dataset.id=r.id;
  for(const [value,title] of Object.entries(roleNames)){const o=node('option',title);o.value=value;select.append(o);}
  select.value=role;select.disabled=!r.editable;select.addEventListener('change',()=>{if(state.ai)cancelAI();invalidatePreview();state.roles.set(r.id,select.value);state.overrides.add(r.id);state.needsReview.delete(r.id);state.reasons.delete(r.id);render();const e=[...document.querySelectorAll('select[data-id]')].find(e=>e.dataset.id===r.id);(e||$('#filter'))?.focus({preventScroll:true});});
  label.append(select);h.append(label);article.append(h,node('p',r.text||'（空白段落）','paragraph-text'),node('p','目前：'+formatText(r),'current'),node('p',diff.length?diff.join('；'):'已符合目前檢查的格式項目。','difference'));
  if(state.reasons.has(r.id))article.append(node('p','AI 建議理由：'+state.reasons.get(r.id),'reason'));
  box.append(article);
 }
 if(state.doc&&!box.children.length)box.append(node('p',filter==='review'?'目前沒有標記待確認的段落。可切換至所有段落查看。':'這個篩選條件沒有段落。','empty'));
 $('#ai-preview').textContent=JSON.stringify({profile:p,paragraphs:state.rows.filter(r=>r.editable).map(r=>({paragraph_id:r.id,text:r.text,rule_role:r.role,formats:r.formats}))},null,2);
}
function profileUnchecked(){const p={};for(const [k,,type] of fields)p[k]=type==='number'?Number($(`[name="${k}"]`).value):$(`[name="${k}"]`).value;p.alignment=$('[name=alignment]').value;p.new_page_chapters=$('[name=new_page_chapters]').checked;return p;}
function blobDownload(blob,name){const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function cancelAI(){const running=!!state.ai;state.ai?.abort();state.ai=null;$('#cancel-ai').hidden=true;if(running){for(const [id,task]of state.previewJobs){if(task.side==='converted'){clearTimeout(task.timer);state.previewJobs.delete(id);task.resolve(false);}}notice('已取消處理。');modelSelectionStatus();}}
async function clearFile(resetInput=true){const epoch=++state.epoch;invalidatePreview();clearPreviews();cancelAI();const id=state.doc;state.doc=null;state.rows=[];state.roles.clear();state.reasons.clear();state.needsReview.clear();state.overrides.clear();if(resetInput)$('#document-file').value='';$('#filename').textContent='';$('#filename').hidden=true;$('#warnings').hidden=true;render();if(id)await api('/documents/'+id,{method:'DELETE'});return epoch;}
async function upload(file){
 const epoch=await clearFile(false);if(!file||epoch!==state.epoch)return;
 selectView('original');
 if(!file.name.toLowerCase().endsWith('.docx'))throw new Error('只接受 .docx 文件，請不要直接改副檔名。');
 if(file.size>state.limits.file_mb*1024*1024)throw new Error(`檔案超過本次啟動的 ${state.limits.file_mb} MB 上限。`);
 notice('正在解析文件…');$('#empty').textContent='正在解析段落與格式…';
 try{
  const data=await (await api('/documents',{method:'POST',body:file})).json();
  if(epoch!==state.epoch){await api('/documents/'+data.document_id,{method:'DELETE'});return;}
  state.doc=data.document_id;state.rows=data.paragraphs;state.canExport=data.can_export;
  for(const r of state.rows)state.roles.set(r.id,r.editable?r.role:'keep');
  $('#filename').textContent=file.name;$('#filename').hidden=false;$('#warnings').replaceChildren(...data.warnings.map(w=>node('p',w)));$('#warnings').hidden=!data.warnings.length;
  notice('文件已載入，可分析並轉換。');render();
  showPreview('original',file);
 }finally{if(epoch===state.epoch)$('#empty').textContent='選取文件後，這裡會列出原文、目前格式與角色建議。';}
}
function action(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>notice(e.message,true)));}
async function init(){
 selectPanel('profile-settings');selectView('original');toggleSettings(innerWidth>1000);
 for(const button of document.querySelectorAll('[data-panel]'))button.addEventListener('click',()=>selectPanel(button.dataset.panel));
 for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>selectView(button.dataset.view));
 $('#toggle-settings').addEventListener('click',()=>toggleSettings($('#settings-panel').hidden));
 $('#model-indicator').addEventListener('click',()=>{toggleSettings(true,'model-settings');$('#provider').focus();});
 $('#connection').addEventListener('mouseleave',()=>delete $('#connection').dataset.dismissed);
 $('#connection').addEventListener('focusout',()=>delete $('#connection').dataset.dismissed);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#connection').dataset.dismissed='true';});
 for(const [name,title,type,min,max,wide] of fields){const label=node('label',title,wide?'wide':'');const input=node('input');input.name=name;input.type=type;input.required=true;if(type==='number'){input.min=min;input.max=max;input.step='.5';}else input.maxLength=80;label.append(input);const basic=['chinese_font','latin_font','body_size','first_line_chars','line_spacing','paragraph_after'].includes(name);$(basic?'#profile-fields':'#advanced-fields').append(label);}
 const response=await fetch('/api/session');if(!response.ok)throw new Error('本機服務無法連接。');const data=await response.json();state.token=data.token;state.defaults=data.profile;state.limits=data.limits||state.limits;$('#upload-document').title=`上傳 DOCX 文件（上限 ${state.limits.file_mb} MB）`;setProfile(data.profile);notice('');connectionStatus('pending','尚未連接模型');
 $('#profile-form').addEventListener('input',()=>{if(state.ai)cancelAI();invalidatePreview();render();});
 $('#filter').addEventListener('change',render);$('#clean-leading').addEventListener('change',()=>{if(state.ai)cancelAI();invalidatePreview();render();});
 action('#upload-document',()=>$('#document-file').click());
 action('#inspect-paragraphs',()=>toggleSettings(true,'review'));
 $('#document-file').addEventListener('change',e=>{const file=e.target.files[0];upload(file).catch(e=>notice(e.message,true));});
 action('#clear-file',async()=>{await clearFile();notice('文件已清除。');});
 action('#reset-roles',()=>{cancelAI();invalidatePreview();for(const r of state.rows)state.roles.set(r.id,r.editable?r.role:'keep');state.reasons.clear();state.needsReview.clear();state.overrides.clear();render();notice('已還原規則角色建議。');});
 action('#reset-profile',()=>{setProfile(state.defaults);notice('已還原起始規格。');});
 action('#save-profile',()=>blobDownload(new Blob([JSON.stringify(profile(),null,2)],{type:'application/json'}),'PoW-profile.json'));
 $('#load-profile').addEventListener('change',async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>20000)throw new Error('規格檔過大。');const p=JSON.parse(await f.text());if(Object.keys(p).sort().join()!==Object.keys(state.defaults).sort().join())throw new Error('規格欄位不完整或含未知欄位。');for(const [k,v]of Object.entries(p)){if(typeof v!==typeof state.defaults[k])throw new Error('規格欄位型別不正確。');}setProfile(p);profile();notice('已匯入規格，請確認數值。');}catch(e){notice(e.message,true);}finally{e.target.value='';}});
 $('#provider').addEventListener('change',()=>{cancelAI();state.connectionVersion++;state.providerReady=false;state.models=[];$('#model').value='';$('#model-list').replaceChildren();$('#endpoint').disabled=$('#provider').value==='openai';$('#endpoint').value=$('#provider').value==='openai'?'https://api.openai.com/v1':$('#provider').value==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:1234/v1';$('#api-key').value='';$('#model-status').textContent='模型來源已變更，請重新連接。';modelSelectionStatus();});
 for(const id of ['#endpoint','#api-key'])$(id).addEventListener('input',()=>{state.connectionVersion++;state.providerReady=false;if(state.ai)cancelAI();modelSelectionStatus();});
 $('#model').addEventListener('input',()=>{if(state.ai)cancelAI();modelSelectionStatus();});
 $('#provider-form').addEventListener('submit',async e=>{e.preventDefault();if(state.ai)cancelAI();const version=++state.connectionVersion;const button=$('#connect');button.disabled=true;button.setAttribute('aria-busy','true');state.providerReady=false;connectionStatus('pending','連接中');$('#model-status').textContent='正在連接模型服務…';try{
  await api('/provider',{method:'POST',json:{kind:$('#provider').value,endpoint:$('#endpoint').value,api_key:$('#api-key').value,model:''}});if(version!==state.connectionVersion)return;$('#api-key').value='';
  const data=await(await api('/models')).json();
  if(version!==state.connectionVersion)return;$('#model-list').replaceChildren(...data.models.map(m=>{const o=node('option');o.value=m;return o;}));state.models=data.models;state.providerReady=true;modelSelectionStatus();
  $('#model-status').textContent=`已連接，找到 ${data.models.length} 個模型。請選擇模型名稱。`;
 }catch(e){if(version===state.connectionVersion){state.providerReady=false;$('#model-status').textContent=e.message;connectionStatus('error','連接失敗');}}finally{button.disabled=false;button.setAttribute('aria-busy','false');}});
 action('#cancel-ai',cancelAI);
 action('#convert-preview',async()=>{
  if(!state.doc)throw new Error('請先選取文件。');if(!state.canExport)throw new Error('此文件目前只能檢查。');
  const p=profile(),model=$('#model').value.trim();
  if(model&&!state.providerReady){
   toggleSettings(true,'model-settings');
   throw new Error('請先連接選定的模型服務。');
  }
  if(state.converted&&!confirm('重新轉換會取代右側的手動編輯，是否繼續？'))return;
  const epoch=state.epoch,doc=state.doc,controller=new AbortController(),button=$('#convert-preview');
  let revision=state.revision,phase='analysis';
  const current=()=>epoch===state.epoch&&revision===state.revision&&state.ai===controller;
  state.ai=controller;button.disabled=true;button.setAttribute('aria-busy','true');$('#export').disabled=true;$('#download-edited').hidden=true;$('#cancel-ai').hidden=false;
  try{
   $('#converted-state').textContent='分析中';button.textContent='分析中…';
   notice(model?'正在使用模型分析段落…':'正在依規則分析段落…');
   if(model){
    connectionStatus('pending','分析中');
    const data=await(await api('/documents/'+doc+'/ai',{method:'POST',json:{profile:p,model},signal:controller.signal})).json();
    if(!current())return;
    state.needsReview.clear();
    for(const s of data.suggestions){
     if(state.overrides.has(s.paragraph_id))continue;
     state.roles.set(s.paragraph_id,s.role);state.reasons.set(s.paragraph_id,s.reason);
     if(s.needs_review)state.needsReview.add(s.paragraph_id);
    }
    invalidatePreview();revision=state.revision;render();connectionStatus('ready','模型已就緒');
   }
   if(!current())return;
   phase='conversion';button.textContent='轉換中…';$('#converted-state').textContent='轉換中';notice('正在套用格式並驗證文件內容…');
   const response=await api('/documents/'+doc+'/preview',{method:'POST',json:exportBody(),signal:controller.signal});const blob=await response.blob();
   if(!current())return;
   const shown=await showPreview('converted',blob);
   if(!current())return;
   state.converted=true;
   state.convertedRevision=revision;
   if(innerWidth<=650)selectView('converted');
   $('#converted-state').textContent=shown?'已轉換，可編輯':'已轉換，預覽未顯示';$('#download-edited').hidden=!shown;
   notice(`已完成${model?' AI':'規則'}分析與轉換。${state.needsReview.size?`有 ${state.needsReview.size} 段建議確認，可開啟段落檢查。`:''}`);
  }catch(e){
   if(!current()||e.name==='AbortError')return;
   $('#converted-state').textContent=phase==='analysis'?'分析失敗，未轉換':'轉換失敗';
   if(model&&phase==='analysis')connectionStatus('error','分析失敗');
   throw e;
  }finally{
   if(state.ai===controller){state.ai=null;$('#cancel-ai').hidden=true;}
   if(controller.signal.aborted&&epoch===state.epoch)$('#converted-state').textContent=state.converted?'設定已變更':'已取消';
   button.disabled=false;button.textContent='分析並轉換';button.setAttribute('aria-busy','false');$('#export').disabled=!state.converted||state.convertedRevision!==state.revision;
  }
 });
 action('#download-edited',async()=>{
  if(!state.converted||$('#download-edited').hidden)throw new Error('請先完成轉換。');
  const epoch=state.epoch,job=state.viewers.converted?.job,button=$('#download-edited');button.disabled=true;
  try{const buffer=await new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{state.editedRequests.delete(requestId);reject(new Error('編輯文件匯出逾時。'));},60000);state.editedRequests.set(requestId,{resolve,reject,timer});$('#converted-preview').contentWindow.postMessage({type:'export-edited',job,requestId},'*');});if(epoch!==state.epoch||job!==state.viewers.converted?.job)return;blobDownload(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'PoW-edited.docx');notice('已下載編輯後文件。');}finally{button.disabled=false;}
 });
 action('#export',async()=>{
  if(!state.doc)throw new Error('請先選取文件並確認段落角色。');if(!state.canExport)throw new Error('此文件包含尚未支援的結構，只能檢查。');
    if(!state.converted||state.convertedRevision!==state.revision)throw new Error('請先分析並轉換目前文件。');
  const p=profile(),epoch=state.epoch;const button=$('#export');button.disabled=true;button.setAttribute('aria-busy','true');notice('正在修正副本並驗證文字與封裝內容…');
  try{const response=await api('/documents/'+state.doc+'/export',{method:'POST',json:{profile:p,selections:[...state.roles].map(([paragraph_id,role])=>({paragraph_id,role})),clean_leading:$('#clean-leading').checked}});const blob=await response.blob();if(epoch!==state.epoch)return;blobDownload(blob,'PoW-result.zip');notice('已產生修正版與檢查報告。請用 Word 確認分頁。');}finally{button.disabled=false;button.setAttribute('aria-busy','false');}
 });
}
init().catch(e=>{connectionStatus('error','服務未連接');notice('無法初始化本機服務，請重新整理或重新啟動 PoW。'+e.message,true);});
