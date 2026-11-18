'use strict';
let currentJob=null;
function fitPages(){
 const wrapper=document.querySelector('.docx-wrapper');if(!wrapper)return;
 wrapper.style.zoom='1';const pages=[...wrapper.querySelectorAll('section.docx')];
 const widest=Math.max(1,...pages.map(p=>p.getBoundingClientRect().width));
 wrapper.style.zoom=String(Math.min(1,(document.documentElement.clientWidth-24)/widest));
}
window.addEventListener('resize',fitPages);
document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();},true);
window.addEventListener('message',async event=>{
 if(event.source!==parent||event.data?.type!=='render-docx'||!(event.data.buffer instanceof ArrayBuffer))return;
 const job=event.data.job;currentJob=job;
 try{
  const body=document.createElement('div'),styles=document.createElement('div');
  await docx.renderAsync(event.data.buffer,body,styles,{inWrapper:true,breakPages:true,ignoreLastRenderedPageBreak:false,renderAltChunks:false,renderComments:false,renderChanges:false,useBase64URL:false});
  if(currentJob!==job)return;
  document.querySelector('#preview-content').replaceChildren(styles,body);fitPages();
  parent.postMessage({type:'preview-rendered',job},'*');
 }catch{parent.postMessage({type:'preview-error',job},'*');}
});
parent.postMessage({type:'preview-ready',job:new URLSearchParams(location.search).get('job')},'*');
