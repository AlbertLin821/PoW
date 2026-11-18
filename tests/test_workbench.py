import io
import json
import zipfile
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient
from lxml import etree as ET
from pow_app.documents import WordDocument, DocumentError, W, NS, q
from pow_app.schemas import Profile, Selection, Provider
from pow_app import providers
from pow_app.server import app, documents

def fixture(paragraphs=None, extras=None):
    paragraphs=paragraphs or '<w:p><w:r><w:t>壹、測試章</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">  正文ABC</w:t></w:r></w:p>'
    parts={
      '[Content_Types].xml':b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'.encode(),
      'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'.encode(),
      'word/media/test.bin':b'unchanged binary asset',
    }
    parts.update(extras or {});b=io.BytesIO()
    with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
        for k,v in parts.items():z.writestr(k,v)
    return b.getvalue()

def test_export_preserves_text_and_untouched_parts():
    d=WordDocument(fixture());out,report=d.export(Profile(),[Selection(paragraph_id='p-1',role='heading1'),Selection(paragraph_id='p-2',role='body')])
    check=WordDocument(out)
    assert [r['text'] for r in d.rows]==[r['text'] for r in check.rows]
    assert check.rows[0]['formats'][0]['size']==18
    assert check.rows[1]['formats'][0]['chinese_font']=='標楷體'
    assert check.rows[1]['formats'][0]['latin_font']=='Times New Roman'
    assert check.rows[1]['first_line_chars']==2
    assert check.parts['word/media/test.bin']==d.parts['word/media/test.bin']
    assert report['verification']['other_package_parts_unchanged']
    margins=check.root.find('.//'+q('pgMar'))
    assert margins.get(q('left'))=='1701'
    assert margins.get(q('top'))=='1134'

def test_only_approved_leading_is_removed():
    d=WordDocument(fixture());out,report=d.export(Profile(),[Selection(paragraph_id='p-2',role='body')],True)
    assert WordDocument(out).rows[1]['text']=='正文ABC'
    assert report['changes'][0]['removed_leading']==2

def test_inline_emphasis_and_fields_preserved():
    p='<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>重要</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>'
    d=WordDocument(fixture(p));assert not d.rows[1]['editable']
    out,_=d.export(Profile(),[Selection(paragraph_id='p-1',role='body'),Selection(paragraph_id='p-2',role='keep')])
    check=WordDocument(out);assert check.rows[0]['formats'][0]['bold']
    assert check.root.find('.//'+q('i')) is not None
    with pytest.raises(DocumentError):d.export(Profile(),[Selection(paragraph_id='p-2',role='body')])

def test_duplicate_selection_rejected():
    d=WordDocument(fixture())
    with pytest.raises(DocumentError):d.export(Profile(),[Selection(paragraph_id='p-1',role='body')]*2)

@pytest.mark.parametrize('data',[b'',b'%PDF fake',b'PK broken'])
def test_bad_files_rejected(data):
    with pytest.raises(DocumentError):WordDocument(data)

def test_revision_blocks_export():
    d=WordDocument(fixture('<w:p><w:ins><w:r><w:t>修訂</w:t></w:r></w:ins></w:p>'))
    assert not d.summary()['can_export']

def test_bomb_and_doctype_rejected():
    b=io.BytesIO()
    with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('huge',b'0'*(61*1024*1024))
    with pytest.raises(DocumentError):WordDocument(b.getvalue())
    with pytest.raises(DocumentError):WordDocument(fixture(extras={'word/document.xml':b'<!DOCTYPE x><x/>'}))

def test_provider_loopback_validation():
    for url in ['https://evil.example/v1','http://127.0.0.1.evil.example','http://user:secret@localhost','http://localhost/v1?url=a']:
        with pytest.raises(providers.ModelError):providers.base_url(Provider(endpoint=url))
    assert providers.base_url(Provider(endpoint='http://127.0.0.1:11434'))=='http://127.0.0.1:11434'

def test_api_flow_and_origin_guard():
    with TestClient(app) as client:
        token=client.get('/api/session').json()['token'];h={'x-pow-token':token}
        assert client.post('/api/documents',content=fixture()).status_code==403
        assert client.get('/api/session',headers={'origin':'https://evil.example'}).status_code==403
        empty=client.post('/api/documents',content=b'',headers=h);assert empty.status_code==400
        doc=client.post('/api/documents',content=fixture(),headers=h).json()
        body={'profile':Profile().model_dump(),'selections':[{'paragraph_id':'p-2','role':'body'}]}
        result=client.post('/api/documents/'+doc['document_id']+'/export',json=body,headers=h)
        assert result.status_code==200
        with zipfile.ZipFile(io.BytesIO(result.content)) as z:assert set(z.namelist())=={'corrected.docx','report.json'}
        client.delete('/api/documents/'+doc['document_id'],headers=h)
        assert client.post('/api/documents/'+doc['document_id']+'/export',json=body,headers=h).status_code==404

def test_models_and_ai_are_validated():
    import asyncio
    rows=WordDocument(fixture()).rows
    valid={'message':{'content':json.dumps({'suggestions':[{'paragraph_id':r['id'],'role':'body','reason':'測試理由','needs_review':True} for r in rows]})}}
    with patch.object(providers,'request',AsyncMock(return_value=valid)):
        result=asyncio.run(providers.classify(Provider(),rows,Profile(),'local-model'))
        assert len(result['suggestions'])==2
    bad={'message':{'content':'{"suggestions":[{"paragraph_id":"unknown","role":"body","reason":"x"}]}'}}
    with patch.object(providers,'request',AsyncMock(return_value=bad)):
        with pytest.raises(providers.ModelError):asyncio.run(providers.classify(Provider(),rows,Profile(),'local-model'))

def test_profile_rejects_nan_and_unknown_fields():
    with pytest.raises(ValueError):Profile(body_size=float('nan'))
    with pytest.raises(ValueError):Profile(hidden_action='delete')

def test_editing_protection_and_multiple_sections_block_export():
    settings=f'<w:settings xmlns:w="{W}"><w:documentProtection w:enforcement="1"/></w:settings>'.encode()
    assert WordDocument(fixture(extras={'word/settings.xml':settings})).blocked
    assert WordDocument(fixture('<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>多節</w:t></w:r></w:p>')).blocked

def test_style_inheritance_and_direct_font_override():
    styles=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Parent" w:type="paragraph"><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:styleId="Child" w:type="paragraph"><w:basedOn w:val="Parent"/></w:style></w:styles>'.encode()
    p='<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="標楷體"/></w:rPr><w:t>繼承</w:t></w:r></w:p>'
    d=WordDocument(fixture(p,{'word/styles.xml':styles}));f=d.rows[0]['formats'][0]
    assert f['chinese_font']=='標楷體' and f['size']==16 and f['bold']

def test_provider_failure_never_creates_fake_suggestions():
    import asyncio
    with patch.object(providers,'request',AsyncMock(side_effect=providers.ModelError('離線'))):
        with pytest.raises(providers.ModelError):asyncio.run(providers.classify(Provider(),WordDocument(fixture()).rows,Profile(),'x'))

def test_adaptive_limits_are_bounded():
    from pow_app.limits import choose_limits, MB
    small=choose_limits(1024*MB);large=choose_limits(64*1024*MB)
    assert small['file_mb']==32 and large['file_mb']==256
    assert small['unpacked_mb']==128 and large['unpacked_mb']==1024
    assert large['preview_mb']==64

def test_preview_returns_the_actual_transformed_docx():
    with TestClient(app) as client:
        h={'x-pow-token':client.get('/api/session').json()['token']}
        doc=client.post('/api/documents',content=fixture(),headers=h).json()
        body={'profile':Profile().model_dump(),'selections':[{'paragraph_id':'p-1','role':'heading1'}]}
        response=client.post('/api/documents/'+doc['document_id']+'/preview',json=body,headers=h)
        assert response.status_code==200
        changed=WordDocument(response.content)
        assert changed.rows[0]['formats'][0]['size']==18
        assert not changed.rows[0]['page_break_before']
        assert changed.parts['word/media/test.bin']==b'unchanged binary asset'

def test_large_image_document_over_old_limit_is_accepted():
    import random
    data=fixture(extras={'word/media/image.bin':random.Random(0).randbytes(16*1024*1024)})
    assert len(data)>15*1024*1024
    d=WordDocument(data)
    assert len(d.rows)==2

def test_tab_stop_definition_is_not_document_text():
    p='<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="480"/><w:tab w:val="left" w:pos="960"/></w:tabs></w:pPr><w:r><w:t>定位點</w:t><w:tab/><w:t>實際Tab</w:t></w:r></w:p>'
    d=WordDocument(fixture(p));assert d.rows[0]['text']=='定位點\t實際Tab';assert d.rows[0]['tabs']==1
    out,report=d.export(Profile(),[Selection(paragraph_id='p-1',role='body')])
    assert WordDocument(out).rows[0]['text']=='定位點\t實際Tab'
    assert report['verification']['text_preserved_except_approved_leading']


def test_sandbox_can_fetch_document_assets_but_not_api():
    with TestClient(app) as client:
        response=client.get('/static/extend/preview.js',headers={'origin':'null'})
        assert response.status_code==200
        assert response.headers['access-control-allow-origin']=='*'
        assert client.get('/api/session',headers={'origin':'null'}).status_code==403
        assert client.get('/static/app.js',headers={'origin':'null'}).status_code==403
