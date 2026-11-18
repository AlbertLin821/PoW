'use strict';
let currentJob=null;
let zoom='fit';
function pages(){return [...document.querySelectorAll('section.docx')];}
function sendState(){
 const list=pages();if(!list.length)return;
 let page=1;for(let i=0;i<list.length;i++){if(list[i].getBoundingClientRect().top<=innerHeight*.35)page=i+1;}
 parent.postMessage({type:'preview-state',job:currentJob,page,total:list.length},'*');
}
function fitPages(){
 const wrapper=document.querySelector('.docx-wrapper');if(!wrapper)return;
 wrapper.style.zoom='1';const pages=[...wrapper.querySelectorAll('section.docx')];
 const widest=Math.max(1,...pages.map(p=>p.getBoundingClientRect().width));
 const scale=zoom==='fit'?Math.min(1,(document.documentElement.clientWidth-24)/widest):Number(zoom);
 wrapper.style.zoom=String(scale);document.body.classList.toggle('manual-zoom',zoom!=='fit');sendState();
}
window.addEventListener('resize',fitPages);
let scrollPending=false;window.addEventListener('scroll',()=>{if(!scrollPending){scrollPending=true;requestAnimationFrame(()=>{sendState();scrollPending=false;});}},{passive:true});
document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();},true);
window.addEventListener('message',async event=>{
 if(event.source===parent&&event.data?.type==='viewer-command'&&event.data.job===currentJob){
  if(event.data.action==='zoom'&&['fit','0.75','1','1.25','1.5'].includes(event.data.value)){zoom=event.data.value;fitPages();}
  if(event.data.action==='page'){const list=pages(),page=Math.max(1,Math.min(list.length,Number(event.data.value)));if(Number.isInteger(page)&&list[page-1])window.scrollTo({top:scrollY+list[page-1].getBoundingClientRect().top-12});sendState();}
  return;
 }
 if(event.source!==parent||event.data?.type!=='render-docx'||!(event.data.buffer instanceof ArrayBuffer))return;
 const job=event.data.job;currentJob=job;
 try{
  const body=document.createElement('div'),styles=document.createElement('div');
  await docx.renderAsync(event.data.buffer,body,styles,{inWrapper:true,breakPages:true,ignoreLastRenderedPageBreak:false,renderAltChunks:false,renderComments:false,renderChanges:false,useBase64URL:false});
  if(currentJob!==job)return;
  document.querySelector('#preview-content').replaceChildren(styles,body);fitPages();
  parent.postMessage({type:'preview-rendered',job,total:pages().length},'*');sendState();
 }catch{parent.postMessage({type:'preview-error',job},'*');}
});
parent.postMessage({type:'preview-ready',job:new URLSearchParams(location.search).get('job')},'*');
