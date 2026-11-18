import io
import re
import zipfile
from lxml import etree as ET
from .schemas import Profile
from .limits import LIMITS, MB

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W, 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
MAX_FILE = LIMITS['file_mb'] * MB
MAX_UNPACKED = LIMITS['unpacked_mb'] * MB

class DocumentError(ValueError):
    pass

def q(name):
    return '{'+W+'}'+name

def xml(data):
    if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
        raise DocumentError('文件含不支援的 XML 宣告。')
    try:
        return ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True))
    except ET.XMLSyntaxError as e:
        raise DocumentError('文件 XML 已損毀。') from e

def value(node, name, attr='val', default=None):
    child = node.find(q(name)) if node is not None else None
    return child.get(q(attr), default) if child is not None else default

def merge(target, source):
    if source is None:
        return
    for child in source:
        key = ET.QName(child).localname
        if key=='rFonts':
            for name in ['ascii','hAnsi','eastAsia','cs']:
                if child.get(q(name)) is not None:
                    target.setdefault(key,{}).pop(name+'Theme',None)
                    if name=='cs':target[key].pop('cstheme',None)
        target.setdefault(key, {}).update({ET.QName(k).localname: v for k, v in child.attrib.items()})
        if not child.attrib:
            target[key]['val'] = '1'

def text_of(p):
    # Paragraph tab-stop definitions use w:tab too; they are not text characters.
    nodes=p.xpath('.//w:t[not(ancestor::w:pPr or ancestor::w:rPr)] | .//w:tab[not(ancestor::w:pPr or ancestor::w:rPr)] | .//w:br[not(ancestor::w:pPr or ancestor::w:rPr)] | .//w:cr[not(ancestor::w:pPr or ancestor::w:rPr)]',namespaces=NS)
    return ''.join((n.text or '') if n.tag==q('t') else '\t' if n.tag==q('tab') else '\n' for n in nodes)

def guess(text, outline):
    if outline is not None and outline.isdigit() and int(outline)<4:
        return 'heading'+str(int(outline)+1)
    if len(text)>90:
        return 'body'
    for pattern, role in [(r'^[壹貳參肆伍陸柒捌玖拾]+[、.]|^第[一二三四五六七八九十0-9]+章', 'heading1'),
                          (r'^[一二三四五六七八九十]+[、.]', 'heading2'),
                          (r'^[（(][一二三四五六七八九十]+[）)]', 'heading3'),
                          (r'^\d+[.]\s*\S', 'heading4')]:
        if re.search(pattern, text.strip()):
            return role
    return 'body' if text.strip() else 'keep'

class WordDocument:
    def __init__(self, data):
        if len(data)>MAX_FILE:
            raise DocumentError(f"檔案超過本次啟動的 {LIMITS['file_mb']} MB 上限。")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                infos=z.infolist()
                if len(infos)>2000 or sum(i.file_size for i in infos)>MAX_UNPACKED:
                    raise DocumentError('解壓縮後容量或項目數超過上限。')
                if any(i.filename.endswith('.xml') and i.file_size>24*MB for i in infos):
                    raise DocumentError('單一 XML 超過 24 MB 上限。')
                names=[i.filename for i in infos]
                if len(set(names))!=len(names) or any(i.flag_bits & 1 for i in infos):
                    raise DocumentError('不支援重複項目或加密文件。')
                if not {'word/document.xml','[Content_Types].xml','_rels/.rels'}<=set(names):
                    raise DocumentError('這不是有效的 DOCX 文件。')
                if any('vbaProject' in n or n.startswith('_xmlsignatures/') for n in names):
                    raise DocumentError('不支援巨集或數位簽章文件。')
                self.parts={i.filename:z.read(i) for i in infos}
                self.infos=infos
        except (zipfile.BadZipFile, RuntimeError, EOFError, NotImplementedError) as e:
            raise DocumentError('無法讀取 DOCX，請確認檔案未損毀或加密。') from e
        self.root=xml(self.parts['word/document.xml'])
        self.styles=xml(self.parts.get('word/styles.xml',f'<w:styles xmlns:w="{W}"/>'.encode()))
        self.stylemap={s.get(q('styleId')):s for s in self.styles.findall(q('style'))}
        self.default_style=next((s.get(q('styleId')) for s in self.styles.findall(q('style')) if s.get(q('type'))=='paragraph' and s.get(q('default'))=='1'),None)
        self.paras=self.root.xpath('/w:document/w:body/w:p',namespaces=NS)
        if len(self.paras)>2000:
            raise DocumentError('目前上限為 2000 個主文件段落。')
        self.warnings=[]
        self.blocked=False
        settings=self.parts.get('word/settings.xml')
        if settings:
            protection=xml(settings).find(q('documentProtection'))
            if protection is not None and protection.get(q('enforcement'),'0') not in ('0','false','off'):
                self.warnings.append('文件已啟用編輯保護，本版不開放匯出。');self.blocked=True
        for expression,label in [('//w:ins|//w:del|//w:moveFrom|//w:moveTo','追蹤修訂'),('//w:altChunk','外部合併內容')]:
            if self.root.xpath(expression,namespaces=NS):
                self.warnings.append(f'含{label}，本版只提供檢查，不開放匯出。');self.blocked=True
        if len(self.root.xpath('//w:sectPr',namespaces=NS))!=1:
            self.warnings.append('含多節或非標準分節，為保留頁首頁尾關係，本版不開放匯出。');self.blocked=True
        tables=len(self.root.xpath('//w:tbl',namespaces=NS))
        if tables:self.warnings.append(f'含 {tables} 個表格，表格內文字與格式保持原樣。')
        if any(n.startswith('word/header') or n.startswith('word/footer') or n.startswith('word/footnotes') for n in self.parts):
            self.warnings.append('頁首頁尾與註腳保持原樣；不新增頁碼或更新欄位。')
        if self.root.xpath('/w:document/w:body/w:sdt',namespaces=NS):
            self.warnings.append('主文件內容控制項內的段落不列入修正。')
        self.rows=[self.inspect(i,p) for i,p in enumerate(self.paras)]

    def chain(self, sid):
        found=[];seen=set()
        while sid and sid not in seen and len(seen)<30:
            seen.add(sid);s=self.stylemap.get(sid)
            if s is None:break
            found.append(s);sid=value(s,'basedOn')
        return reversed(found)

    def properties(self,p,r=None):
        pp={};rp={}
        defaults=self.styles.find(q('docDefaults'))
        if defaults is not None:
            merge(pp,defaults.find('w:pPrDefault/w:pPr',NS));merge(rp,defaults.find('w:rPrDefault/w:rPr',NS))
        ppr=p.find(q('pPr'));sid=value(ppr,'pStyle',default=self.default_style)
        for s in self.chain(sid):
            merge(pp,s.find(q('pPr')));merge(rp,s.find(q('rPr')))
        merge(pp,ppr)
        if r is not None:
            rpr=r.find(q('rPr'))
            for s in self.chain(value(rpr,'rStyle')):merge(rp,s.find(q('rPr')))
            merge(rp,rpr)
        return pp,rp

    def font_name(self,attrs,script):
        theme_key={'eastAsia':'eastAsiaTheme','ascii':'asciiTheme'}[script]
        # Theme attributes supersede the explicit font at the same resolved level.
        if theme_key in attrs:
            data=self.parts.get('word/theme/theme1.xml')
            if data:
                theme=xml(data);kind='major' if attrs[theme_key].startswith('major') else 'minor'
                path=f'.//a:{kind}Font/a:font[@script="Hant"]' if script=='eastAsia' else f'.//a:{kind}Font/a:latin'
                node=theme.find(path,NS)
                if node is not None:return node.get('typeface','未指定')
            return '佈景主題字型'
        return attrs.get(script,'未指定')

    def inspect(self,i,p):
        text=text_of(p);pp,_=self.properties(p)
        complex_tags={'fldChar','fldSimple','instrText','drawing','pict','object','sdt','hyperlink','oMath','oMathPara','sym','ruby','footnoteReference','endnoteReference','commentReference'}
        reasons=sorted({ET.QName(n).localname for n in p.iter() if ET.QName(n).localname in complex_tags})
        if 'numPr' in pp:reasons.append('自動編號')
        if not text.strip():reasons.append('空白段落')
        runs=p.findall(q('r'));formats=[]
        for r in runs:
            if r.find(q('t')) is None:continue
            _,rp=self.properties(p,r);rf=rp.get('rFonts',{})
            formats.append({'chinese_font':self.font_name(rf,'eastAsia'),'latin_font':self.font_name(rf,'ascii'),
                            'size':float(rp.get('sz',{}).get('val',24))/2,
                            'bold':rp.get('b',{}).get('val','0') not in ('0','false','off')})
        unique=[]
        for f in formats:
            if f not in unique:unique.append(f)
        ind=pp.get('ind',{});sp=pp.get('spacing',{})
        return {'id':f'p-{i+1}','text':text,'role':guess(text,pp.get('outlineLvl',{}).get('val')),
                'editable':not reasons,'skip_reason':'、'.join(reasons),'formats':unique,
                'alignment':pp.get('jc',{}).get('val','left'),
                'first_line_chars':float(ind['firstLineChars'])/100 if 'firstLineChars' in ind else None,
                'first_line_pt':float(ind.get('firstLine',0))/20,
                'line_spacing':float(sp.get('line',240))/240 if sp.get('lineRule','auto')=='auto' else None,
                'left_indent_pt':float(ind.get('left',0))/20,
                'right_indent_pt':float(ind.get('right',0))/20,
                'space_before':float(sp.get('before',0))/20,'space_after':float(sp.get('after',0))/20,
                'outline_level':int(pp.get('outlineLvl',{}).get('val',9)),
                'page_break_before':pp.get('pageBreakBefore',{}).get('val','0') not in ('0','false','off'),
                'tabs':len(p.xpath('.//w:tab[not(ancestor::w:pPr or ancestor::w:rPr)]',namespaces=NS)),'leading':len(text)-len(text.lstrip(' \t\u3000')),
                'style':value(p.find(q('pPr')),'pStyle',default=self.default_style)}

    def summary(self):
        return {'paragraphs':self.rows,'warnings':self.warnings,'can_export':not self.blocked,
                'scope':'僅處理主文件一般段落；表格、複雜物件與略過段落保留。未執行 Word 排版渲染。'}

    def export(self,profile:Profile,selections,clean=False):
        if self.blocked:raise DocumentError('此文件含本版尚未支援的結構，只能檢查。')
        ids=[s.paragraph_id for s in selections]
        allowed={r['id'] for r in self.rows}
        if len(set(ids))!=len(ids) or not set(ids)<=allowed:raise DocumentError('段落選擇包含重複或未知識別。')
        roles={s.paragraph_id:s.role for s in selections};changes=[]
        root=xml(self.parts['word/document.xml']);paras=root.xpath('/w:document/w:body/w:p',namespaces=NS)
        original=[text_of(p) for p in paras];expected=original.copy()
        def setprop(parent,name,**attrs):
            for child in list(parent):
                if child.tag==q(name):parent.remove(child)
            node=ET.SubElement(parent,q(name))
            for k,v in attrs.items():node.set(q(k),str(v))
            return node
        for i,(p,row) in enumerate(zip(paras,self.rows)):
            role=roles.get(row['id'],'keep')
            if role=='keep':continue
            if not row['editable']:raise DocumentError('不能修改含複雜物件或編號的段落，請選擇保留。')
            pp=p.find(q('pPr'))
            if pp is None:pp=ET.Element(q('pPr'));p.insert(0,pp)
            for tag in ['tabs','contextualSpacing']:
                for node in pp.findall(q(tag)):pp.remove(node)
            heading=role.startswith('heading');size=getattr(profile,role) if heading else profile.body_size
            setprop(pp,'jc',val='left' if heading else profile.alignment)
            setprop(pp,'ind',left=0,right=0,firstLine=0 if heading else round(size*profile.first_line_chars*20),firstLineChars=0 if heading else round(profile.first_line_chars*100))
            setprop(pp,'spacing',before=round(size*20) if heading and role!='heading1' else 0,after=round(size*20) if role=='heading1' else round(profile.paragraph_after*20),line=round(profile.line_spacing*240),lineRule='auto')
            setprop(pp,'outlineLvl',val=int(role[-1])-1 if heading else 9)
            setprop(pp,'keepNext',val=1 if heading else 0)
            setprop(pp,'keepLines',val=1 if heading else 0)
            setprop(pp,'pageBreakBefore',val=1 if role=='heading1' and profile.new_page_chapters and i>0 else 0)
            setprop(pp,'snapToGrid',val=0)
            for r in p.findall(q('r')):
                rp=r.find(q('rPr'))
                if rp is None:rp=ET.Element(q('rPr'));r.insert(0,rp)
                setprop(rp,'rFonts',ascii=profile.latin_font,hAnsi=profile.latin_font,eastAsia=profile.chinese_font,cs=profile.latin_font)
                setprop(rp,'sz',val=round(size*2));setprop(rp,'szCs',val=round(size*2))
                if heading:setprop(rp,'b',val=1);setprop(rp,'bCs',val=1)
                # Body emphasis is retained; all other inline semantics stay untouched.
            removed=0
            if clean and not heading:
                remaining=row['leading']
                for r in p.findall(q('r')):
                    for n in list(r):
                        if not remaining:break
                        if n.tag==q('tab'):r.remove(n);remaining-=1;removed+=1
                        elif n.tag==q('t'):
                            s=n.text or '';cut=min(remaining,len(s)-len(s.lstrip(' \t\u3000')))
                            n.text=s[cut:];remaining-=cut;removed+=cut
                        elif n.tag!=q('rPr'):remaining=0
                expected[i]=original[i][removed:]
            changes.append({'paragraph_id':row['id'],'role':role,'size_pt':size,'removed_leading':removed,
                            'before':{k:v for k,v in row.items() if k not in ('text','id','role')},
                            'after':{'chinese_font':profile.chinese_font,'latin_font':profile.latin_font,'size_pt':size,'alignment':'left' if heading else profile.alignment,'first_line_chars':0 if heading else profile.first_line_chars,'line_spacing':profile.line_spacing}})
        sect=root.find('.//'+q('sectPr'))
        setprop(sect,'pgSz',w=11906,h=16838,orient='portrait')
        old_margin=sect.find(q('pgMar'))
        preserve={name:old_margin.get(q(name),fallback) if old_margin is not None else fallback for name,fallback in [('header','720'),('footer','567'),('gutter','0')]}
        setprop(sect,'pgMar',top=round(profile.top/2.54*1440),bottom=round(profile.bottom/2.54*1440),left=round(profile.left/2.54*1440),right=round(profile.right/2.54*1440),**preserve)
        cols=sect.find(q('cols'))
        if cols is not None:sect.remove(cols)
        setprop(sect,'cols',num=1)
        if [text_of(p) for p in paras]!=expected:
            raise DocumentError('內容保留檢查未通過，已停止匯出。')
        updated=ET.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for info in self.infos:z.writestr(info,updated if info.filename=='word/document.xml' else self.parts[info.filename])
        result=buf.getvalue()
        with zipfile.ZipFile(io.BytesIO(result)) as z:
            if not all(z.read(n)==v for n,v in self.parts.items() if n!='word/document.xml'):
                raise DocumentError('封裝保留檢查未通過，已停止匯出。')
        report={'changes':changes,'verification':{'text_preserved_except_approved_leading':True,'other_package_parts_unchanged':True,'word_rendered':False},
                'profile':profile.model_dump(),'warnings':self.warnings,'page_layout':'已套用 A4 單欄及指定頁邊界；不新增頁碼。'}
        return result,report
