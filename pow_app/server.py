import asyncio
import io
import json
import secrets
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from .schemas import Profile, Provider, ExportRequest, AIRequest
from .documents import WordDocument, DocumentError, MAX_FILE
from . import providers

STATIC=Path(__file__).resolve().parents[1]/'static'
@asynccontextmanager
async def lifespan(app):
    async def expire():
        while True:
            await asyncio.sleep(60)
            for key in list(documents):
                if time.monotonic()-documents[key]['time']>1800:documents.pop(key,None)
    task=asyncio.create_task(expire())
    try:yield
    finally:
        task.cancel();documents.clear()

app=FastAPI(title='PoW',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
TOKEN=secrets.token_urlsafe(32)
documents={}
provider=Provider()
model_lock=asyncio.Lock()

@app.middleware('http')
async def local_guard(request:Request,call_next):
    host=request.url.hostname
    if host not in ('127.0.0.1','localhost','testserver','::1'):
        return JSONResponse({'detail':'只允許本機存取。'},status_code=403)
    origin=request.headers.get('origin')
    if origin and origin!=str(request.base_url).rstrip('/'):
        return JSONResponse({'detail':'不接受其他網站的請求。'},status_code=403)
    if request.url.path.startswith('/api/') and request.url.path!='/api/session':
        if not secrets.compare_digest(request.headers.get('x-pow-token',''),TOKEN):
            return JSONResponse({'detail':'工作階段已失效，請重新整理頁面。'},status_code=403)
    if request.method=='POST' and request.url.path!='/api/documents':
        # Bound JSON bodies even when Content-Length is absent.
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>1024*1024:return JSONResponse({'detail':'請求內容超過上限。'},status_code=413)
        request._body=bytes(data)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['Cache-Control']='no-store'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response

@app.exception_handler(DocumentError)
@app.exception_handler(providers.ModelError)
async def known_error(request,exc):
    return JSONResponse({'detail':str(exc)},status_code=400)

@app.exception_handler(Exception)
async def unexpected(request,exc):
    return JSONResponse({'detail':'處理失敗，原檔未修改。請重新載入文件；若仍失敗，請檢查是否為支援的 DOCX。'},status_code=500)

@app.get('/')
async def index():return FileResponse(STATIC/'index.html')

@app.get('/api/session')
async def session():return {'token':TOKEN,'profile':Profile().model_dump(),'api_key_available':bool(__import__('os').environ.get('OPENAI_API_KEY'))}

def get_doc(doc_id):
    now=time.monotonic()
    for key in list(documents):
        if now-documents[key]['time']>1800:documents.pop(key,None)
    if doc_id not in documents:raise HTTPException(404,'文件已過期或已清除，請重新選取。')
    documents[doc_id]['time']=now
    return documents[doc_id]

@app.post('/api/documents')
async def upload(request:Request):
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>MAX_FILE:raise HTTPException(413,'檔案超過 15 MB 上限。')
    if not data:raise DocumentError('請先選取 DOCX 文件。')
    try:doc=WordDocument(bytes(data))
    except (ValueError,TypeError,OverflowError) as e:
        if isinstance(e,DocumentError):raise
        raise DocumentError('文件屬性異常，無法安全解析。') from e
    while documents and (len(documents)>=8 or sum(sum(len(v) for v in x['doc'].parts.values()) for x in documents.values())+sum(len(v) for v in doc.parts.values())>120*1024*1024):
        oldest=min(documents,key=lambda k:documents[k]['time']);documents.pop(oldest)
    doc_id=secrets.token_urlsafe(18);documents[doc_id]={'doc':doc,'time':time.monotonic()}
    return {'document_id':doc_id,**doc.summary()}

@app.delete('/api/documents/{doc_id}')
async def remove(doc_id:str):
    documents.pop(doc_id,None);return {'cleared':True}

@app.post('/api/documents/{doc_id}/export')
async def export(doc_id:str,body:ExportRequest):
    data,report=get_doc(doc_id)['doc'].export(body.profile,body.selections,body.clean_leading)
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('corrected.docx',data)
        z.writestr('report.json',json.dumps(report,ensure_ascii=False,indent=2))
    return Response(output.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="PoW-result.zip"'})

@app.post('/api/provider')
async def configure(body:Provider):
    global provider
    providers.base_url(body)
    provider=body
    return {'kind':body.kind,'endpoint':providers.base_url(body),'has_key':bool(body.api_key)}

@app.get('/api/models')
async def list_models():
    return {'models':await providers.models(provider.model_copy(deep=True))}

@app.post('/api/documents/{doc_id}/ai')
async def analyze(doc_id:str,body:AIRequest):
    doc=get_doc(doc_id)['doc'];config=provider.model_copy(deep=True)
    if model_lock.locked():raise HTTPException(409,'已有模型請求進行中，請稍後再試。')
    async with model_lock:
        result=await providers.classify(config,doc.rows,body.profile,body.model)
    return {'document_id':doc_id,**result}

app.mount('/static',StaticFiles(directory=STATIC),name='static')
