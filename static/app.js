'use strict';
const $ = s => document.querySelector(s);
const state = {token:'', defaults:null, doc:null, rows:[], roles:new Map(), reasons:new Map(), epoch:0, ai:null, providerReady:false, models:[], connectionVersion:0};
const roleNames = {body:'正文',heading1:'章標題',heading2:'節標題',heading3:'小節標題',heading4:'次小節標題',keep:'保留原樣'};
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
 $('#connection-tooltip').textContent=`${label}：${description} 點選可展開模型設定。`;
 $('#model-indicator').setAttribute('aria-label',$('#connection-label').textContent+'，'+label+'，'+description);
}
function modelSelectionStatus(){
 const selected=$('#model').value.trim();
 if(!state.providerReady)connectionStatus('pending','設定尚未驗證，請連接模型服務。');
 else if(!selected)connectionStatus('pending','服務已連接，尚未選擇模型。');
 else if(state.models.includes(selected))connectionStatus('ready','服務已連接，且模型存在於清單中；尚不代表推論已成功。');
 else connectionStatus('pending','服務已連接，但此模型名稱未在清單中，需分析確認。');
}
function detailError(data){if(typeof data.detail==='string')return data.detail;if(Array.isArray(data.detail))return '格式設定不合法：'+data.detail.map(x=>x.loc.slice(-1)+': '+x.msg).join('；');return '請求失敗，請重試。';}
async function api(path,options={}){
 const headers={'X-PoW-Token':state.token,...options.headers};
 if(options.json){headers['Content-Type']='application/json';options.body=JSON.stringify(options.json);delete options.json;}
 const response=await fetch('/api'+path,{...options,headers});
 if(!response.ok){let data;try{data=await response.json();}catch{data={detail:'本機服務未回應，請確認仍在執行。'};}throw new Error(detailError(data));}
 return response;
}
function setProfile(profile){if(state.ai)cancelAI();$('#ai-consent').checked=false;for(const [k,v] of Object.entries(profile)){const e=$(`[name="${k}"]`);if(e){if(e.type==='checkbox')e.checked=v;else e.value=v;}}render();}
function profile(){if(!$('#profile-form').reportValidity())throw new Error('請先修正格式規格的欄位。');const p={};for(const [k,,type] of fields)p[k]=type==='number'?Number($(`[name="${k}"]`).value):$(`[name="${k}"]`).value.trim();p.alignment=$('[name=alignment]').value;p.new_page_chapters=$('[name=new_page_chapters]').checked;return p;}
function formatText(r){return r.formats.map(f=>`${f.chinese_font} / ${f.latin_font}，${f.size} pt${f.bold?'，粗體':''}`).join('；')||'未包含一般文字';}
function differences(r,p,role){
 if(role==='keep'||!r.editable)return ['保留原樣'+(r.skip_reason?'：'+r.skip_reason:'')];
 const heading=role.startsWith('heading'),size=heading?p[role]:p.body_size,out=[];
 if(r.formats.some(f=>f.chinese_font!==p.chinese_font||f.latin_font!==p.latin_font))out.push(`字型改為 ${p.chinese_font} / ${p.latin_font}`);
 if(r.formats.some(f=>f.size!==size))out.push(`字級改為 ${size} pt`);
 if(heading&&r.formats.some(f=>!f.bold))out.push('標題加粗');
 const align=heading?'left':p.alignment;if(r.alignment!==align)out.push('調整段落對齊');
 if((heading?0:p.first_line_chars)!==r.first_line_chars)out.push(`首行縮排 ${heading?0:p.first_line_chars} 字`);
 if(r.left_indent_pt||r.right_indent_pt)out.push('清除左右段落縮排');
 if(r.line_spacing!==p.line_spacing)out.push(`行距 ${p.line_spacing} 倍`);
 if($('#clean-leading').checked&&!heading&&r.leading)out.push(`移除 ${r.leading} 個段首空白／Tab`);
 if(r.space_before!==(heading&&role!=='heading1'?size:0)||r.space_after!==(role==='heading1'?size:p.paragraph_after))out.push('調整段前與段後間距');
 if(r.outline_level!==(heading?Number(role.slice(-1))-1:9))out.push('設定段落大綱層級');
 if(r.page_break_before!==(role==='heading1'&&p.new_page_chapters))out.push('調整段前分頁');
 return out;
}
function render(){
 if(!state.defaults)return;
 let p;try{p=profileUnchecked();}catch{return;}
 $('#page-preview').textContent=`頁面將設為 A4 單欄，上 ${p.top}、下 ${p.bottom}、左 ${p.left}、右 ${p.right} cm。`;
 const box=$('#paragraphs');box.replaceChildren();const filter=$('#filter').value;
 $('#empty').hidden=!!state.doc;$('#ai-tools').hidden=!state.doc;
 $('#counts').textContent=state.doc?`${state.rows.length} 段，${state.rows.filter(r=>!r.editable).length} 段略過`:'尚未載入文件';
 for(const r of state.rows){
  const role=state.roles.get(r.id)||'keep',diff=differences(r,p,role);
  if(filter==='keep'&&role!=='keep'&&r.editable)continue;
  if(filter==='changed'&&(role==='keep'||!r.editable||!diff.length))continue;
  const article=node('article',undefined,'paragraph');const h=node('div',undefined,'paragraph-head');h.append(node('strong',r.id));
  const label=node('label','角色');const select=node('select');select.setAttribute('aria-label',r.id+' 段落角色');select.dataset.id=r.id;
  for(const [value,title] of Object.entries(roleNames)){const o=node('option',title);o.value=value;select.append(o);}
  select.value=role;select.disabled=!r.editable;select.addEventListener('change',()=>{if(state.ai)cancelAI();state.roles.set(r.id,select.value);state.reasons.delete(r.id);render();const e=[...document.querySelectorAll('select[data-id]')].find(e=>e.dataset.id===r.id);e?.focus({preventScroll:true});});
  label.append(select);h.append(label);article.append(h,node('p',r.text||'（空白段落）','paragraph-text'),node('p','目前：'+formatText(r),'current'),node('p',diff.length?diff.join('；'):'已符合目前檢查的格式項目。','difference'));
  if(state.reasons.has(r.id))article.append(node('p','AI 建議理由：'+state.reasons.get(r.id),'reason'));
  box.append(article);
 }
 if(state.doc&&!box.children.length)box.append(node('p','這個篩選條件沒有段落。','empty'));
 $('#ai-preview').textContent=JSON.stringify({profile:p,paragraphs:state.rows.filter(r=>r.editable).map(r=>({paragraph_id:r.id,text:r.text,rule_role:r.role,formats:r.formats}))},null,2);
}
function profileUnchecked(){const p={};for(const [k,,type] of fields)p[k]=type==='number'?Number($(`[name="${k}"]`).value):$(`[name="${k}"]`).value;p.alignment=$('[name=alignment]').value;p.new_page_chapters=$('[name=new_page_chapters]').checked;return p;}
function blobDownload(blob,name){const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function cancelAI(){const running=!!state.ai;state.ai?.abort();state.ai=null;$('#cancel-ai').hidden=true;$('#analyze-ai').disabled=false;if(running){$('#ai-status').textContent='已取消等待，未套用結果。模型端可能仍在完成請求。';connectionStatus('pending','已取消等待，未確認模型目前狀態。');}}
async function clearFile(){const epoch=++state.epoch;cancelAI();const id=state.doc;state.doc=null;state.rows=[];state.roles.clear();state.reasons.clear();$('#document-file').value='';$('#filename').textContent='檔案會傳至這台電腦的 PoW 服務，不覆寫原檔。';$('#warnings').hidden=true;$('#ai-consent').checked=false;render();if(id)await api('/documents/'+id,{method:'DELETE'});return epoch;}
async function upload(file){
 const epoch=await clearFile();if(!file||epoch!==state.epoch)return;
 if(!file.name.toLowerCase().endsWith('.docx'))throw new Error('只接受 .docx 文件，請不要直接改副檔名。');
 if(file.size>15*1024*1024)throw new Error('檔案超過 15 MB 上限。');
 notice('正在解析文件…');$('#empty').textContent='正在解析段落與格式…';
 try{
  const data=await (await api('/documents',{method:'POST',body:file})).json();
  if(epoch!==state.epoch){await api('/documents/'+data.document_id,{method:'DELETE'});return;}
  state.doc=data.document_id;state.rows=data.paragraphs;state.canExport=data.can_export;
  for(const r of state.rows)state.roles.set(r.id,r.editable?r.role:'keep');
  $('#filename').textContent=file.name;$('#warnings').replaceChildren(...data.warnings.map(w=>node('p',w)));$('#warnings').hidden=!data.warnings.length;
  notice('文件已載入。請逐段確認角色與修正預覽。');render();
 }finally{if(epoch===state.epoch)$('#empty').textContent='選取文件後，這裡會列出原文、目前格式與角色建議。';}
}
function action(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>notice(e.message,true)));}
async function init(){
 $('#profile-settings').open=false;$('#model-settings').open=false;
 $('#model-indicator').addEventListener('click',()=>{$('#model-settings').open=true;$('#provider').focus();});
 $('#connection').addEventListener('mouseleave',()=>delete $('#connection').dataset.dismissed);
 $('#connection').addEventListener('focusout',()=>delete $('#connection').dataset.dismissed);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#connection').dataset.dismissed='true';});
 for(const [name,title,type,min,max,wide] of fields){const label=node('label',title,wide?'wide':'');const input=node('input');input.name=name;input.type=type;input.required=true;if(type==='number'){input.min=min;input.max=max;input.step='.5';}else input.maxLength=80;label.append(input);$('#profile-fields').append(label);}
 const response=await fetch('/api/session');if(!response.ok)throw new Error('本機服務無法連接。');const data=await response.json();state.token=data.token;state.defaults=data.profile;setProfile(data.profile);notice('');connectionStatus('pending','尚未連接模型，可先手動整理文件。');
 $('#profile-form').addEventListener('input',()=>{if(state.ai)cancelAI();$('#ai-consent').checked=false;render();});
 $('#filter').addEventListener('change',render);$('#clean-leading').addEventListener('change',render);
 $('#document-file').addEventListener('change',e=>{const file=e.target.files[0];upload(file).catch(e=>notice(e.message,true));});
 action('#clear-file',async()=>{await clearFile();notice('文件已清除。');});
 action('#reset-roles',()=>{cancelAI();for(const r of state.rows)state.roles.set(r.id,r.editable?r.role:'keep');state.reasons.clear();render();notice('已還原規則角色建議。');});
 action('#reset-profile',()=>{setProfile(state.defaults);notice('已還原起始規格。');});
 action('#save-profile',()=>blobDownload(new Blob([JSON.stringify(profile(),null,2)],{type:'application/json'}),'PoW-profile.json'));
 $('#load-profile').addEventListener('change',async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>20000)throw new Error('規格檔過大。');const p=JSON.parse(await f.text());if(Object.keys(p).sort().join()!==Object.keys(state.defaults).sort().join())throw new Error('規格欄位不完整或含未知欄位。');for(const [k,v]of Object.entries(p)){if(typeof v!==typeof state.defaults[k])throw new Error('規格欄位型別不正確。');}setProfile(p);profile();notice('已匯入規格，請確認數值。');}catch(e){notice(e.message,true);}finally{e.target.value='';}});
 $('#provider').addEventListener('change',()=>{cancelAI();state.connectionVersion++;state.providerReady=false;state.models=[];$('#ai-consent').checked=false;$('#model').value='';$('#model-list').replaceChildren();$('#endpoint').disabled=$('#provider').value==='openai';$('#endpoint').value=$('#provider').value==='openai'?'https://api.openai.com/v1':$('#provider').value==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:1234/v1';$('#api-key').value='';$('#model-status').textContent='模型來源已變更，請重新連接。';modelSelectionStatus();});
 for(const id of ['#endpoint','#api-key'])$(id).addEventListener('input',()=>{state.connectionVersion++;state.providerReady=false;$('#ai-consent').checked=false;if(state.ai)cancelAI();modelSelectionStatus();});
 $('#model').addEventListener('input',()=>{if(state.ai)cancelAI();$('#ai-consent').checked=false;modelSelectionStatus();});
 $('#provider-form').addEventListener('submit',async e=>{e.preventDefault();const version=++state.connectionVersion;const button=$('#connect');button.disabled=true;button.setAttribute('aria-busy','true');state.providerReady=false;connectionStatus('pending','正在連接模型服務。');$('#model-status').textContent='正在連接模型服務…';try{
  await api('/provider',{method:'POST',json:{kind:$('#provider').value,endpoint:$('#endpoint').value,api_key:$('#api-key').value,model:''}});if(version!==state.connectionVersion)return;$('#api-key').value='';
  const data=await(await api('/models')).json();
  if(version!==state.connectionVersion)return;$('#model-list').replaceChildren(...data.models.map(m=>{const o=node('option');o.value=m;return o;}));state.models=data.models;state.providerReady=true;modelSelectionStatus();
  $('#model-status').textContent=`已連接，找到 ${data.models.length} 個模型。請選擇模型名稱。`;
 }catch(e){if(version===state.connectionVersion){state.providerReady=false;$('#model-status').textContent=e.message;connectionStatus('error',e.message);}}finally{button.disabled=false;button.setAttribute('aria-busy','false');}});
 action('#analyze-ai',async()=>{
  if(!state.doc)throw new Error('請先選取文件。');if(!state.providerReady)throw new Error('請先在模型設定連接服務。');if(!$('#model').value.trim())throw new Error('請輸入或選擇模型名稱。');if(!$('#ai-consent').checked)throw new Error('請先確認模型來源與資料範圍。');
  const p=profile(),epoch=state.epoch,doc=state.doc,controller=new AbortController();state.ai=controller;connectionStatus('pending','模型正在分析段落。');$('#analyze-ai').disabled=true;$('#cancel-ai').hidden=false;$('#ai-status').textContent='AI 正在分析段落，文件尚未修改…';
  try{const data=await(await api('/documents/'+doc+'/ai',{method:'POST',json:{profile:p,model:$('#model').value.trim()},signal:controller.signal})).json();if(epoch!==state.epoch||state.ai!==controller)return;
   for(const s of data.suggestions){state.roles.set(s.paragraph_id,s.role);state.reasons.set(s.paragraph_id,s.reason+(s.needs_review?'（請人工確認）':''));}render();connectionStatus('ready','此模型已成功完成段落分析。');$('#ai-status').textContent='AI 建議已顯示。請檢查每段角色，再確認匯出。';
  }catch(e){if(e.name!=='AbortError'&&state.ai===controller){$('#ai-status').textContent=e.message;connectionStatus('error',e.message);}}finally{if(state.ai===controller){state.ai=null;$('#analyze-ai').disabled=false;$('#cancel-ai').hidden=true;}}
 });
 action('#cancel-ai',cancelAI);
 action('#export',async()=>{
  if(!state.doc)throw new Error('請先選取文件並確認段落角色。');if(!state.canExport)throw new Error('此文件包含尚未支援的結構，只能檢查。');
  const p=profile(),epoch=state.epoch;const button=$('#export');button.disabled=true;button.setAttribute('aria-busy','true');notice('正在修正副本並驗證文字與封裝內容…');
  try{const response=await api('/documents/'+state.doc+'/export',{method:'POST',json:{profile:p,selections:[...state.roles].map(([paragraph_id,role])=>({paragraph_id,role})),clean_leading:$('#clean-leading').checked}});const blob=await response.blob();if(epoch!==state.epoch)return;blobDownload(blob,'PoW-result.zip');notice('已產生修正版與檢查報告。請用 Word 確認分頁。');}finally{button.disabled=false;button.setAttribute('aria-busy','false');}
 });
}
init().catch(e=>{connectionStatus('error','無法連接 PoW 本機服務，請重新啟動。');notice('無法初始化本機服務，請重新整理或重新啟動 PoW。'+e.message,true);});
