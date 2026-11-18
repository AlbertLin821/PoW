import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {setWasmSource,initWasm,type DocxEditorController} from '@extend-ai/react-docx'
import {DocxViewerPreview} from './components/extend/docx-viewer'
import {DocxEditorPreview} from './components/extend/docx-editor'

const job=new URLSearchParams(location.search).get('job')
const mode=new URLSearchParams(location.search).get('mode')||'viewer'
let currentUrl:string|undefined
function App(){
 const [src,setSrc]=React.useState<string>();const [dark,setDark]=React.useState(false)
 const controller=React.useRef<DocxEditorController|undefined>(undefined);
 const onController=React.useCallback((editor:DocxEditorController)=>{controller.current=editor},[])
 React.useEffect(()=>{
  const onMessage=async(event:MessageEvent)=>{
   if(event.source===parent&&event.data?.type==='export-edited'&&event.data.job===job){
    try{if(!controller.current)throw new Error('not ready');const buffer=await controller.current.getDocxBytes();parent.postMessage({type:'edited-bytes',job,requestId:event.data.requestId,buffer},'*',[buffer])}
    catch{parent.postMessage({type:'edited-export-error',job,requestId:event.data.requestId},'*')}
    return
   }
   if(event.source!==parent||event.data?.type!=='render-docx'||event.data.job!==job||!(event.data.buffer instanceof ArrayBuffer))return
   if(currentUrl)URL.revokeObjectURL(currentUrl)
   currentUrl=URL.createObjectURL(new Blob([event.data.buffer],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));setSrc(currentUrl)
  }
  addEventListener('message',onMessage);parent.postMessage({type:'preview-ready',job},'*')
  return()=>{removeEventListener('message',onMessage);if(currentUrl)URL.revokeObjectURL(currentUrl)}
 },[])
 React.useEffect(()=>{
  if(!src)return
  const start=Date.now();const timer=setInterval(()=>{
   const failure=document.body.innerText.includes('Failed to load DOCX')||document.body.innerText.includes('Unable to edit DOCX')
   if(failure){parent.postMessage({type:'preview-error',job},'*');clearInterval(timer);return}
   const content=document.querySelector('[data-docx-source-id^="docx:"]')
   if(content){parent.postMessage({type:'preview-rendered',job,total:1},'*');clearInterval(timer)}
   else if(Date.now()-start>90000){parent.postMessage({type:'preview-error',job},'*');clearInterval(timer)}
  },250);return()=>clearInterval(timer)
 },[src])
 return <div className="preview-root">{src&&(mode==='editor'?<DocxEditorPreview className="h-full rounded-none border-0" src={src} fileName="PoW-edited.docx" isDark={dark} onIsDarkChange={setDark} onController={onController}/>:<DocxViewerPreview className="h-full rounded-none border-0" src={src} fileName="original.docx" isDark={dark} onIsDarkChange={setDark} defaultZoom="fit-width" showUpload={false} showDownload={false}/>)}</div>
}
class Boundary extends React.Component<React.PropsWithChildren, {error:boolean}>{state={error:false};static getDerivedStateFromError(){return {error:true}}componentDidCatch(){parent.postMessage({type:'preview-error',job},'*')}render(){return this.state.error?<p className="preview-error">無法載入文件元件</p>:this.props.children}}
async function start(){
 const response=await fetch('/static/extend/docx_wasm_bg.wasm');if(!response.ok)throw new Error('WASM not available')
 // Response sources select the library's supported main-thread import path,
 // because opaque sandbox frames cannot create same-origin module workers.
 const bytes=await response.arrayBuffer();setWasmSource(new Response(bytes,{headers:{'Content-Type':'application/wasm'}}));await initWasm()
 createRoot(document.getElementById('root')!).render(<Boundary><App/></Boundary>)
}
start().catch(()=>{document.getElementById('root')!.textContent='文件元件初始化失敗';parent.postMessage({type:'preview-error',job},'*')})
