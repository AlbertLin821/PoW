import{d as s,e as o,f as r,m}from"./chunk-E3H45YZF.js";async function g(e){let n=await r(e),{parts:t,binaryAssets:c,warnings:a}=s(n);return{parts:t,binaryAssets:c,...a.length>0?{warnings:a}:{}}}async function f(e){return m(o(e))}function u(e=l){return{parts:new Map([["[Content_Types].xml",{name:"[Content_Types].xml",content:p}],["_rels/.rels",{name:"_rels/.rels",content:w}],["word/document.xml",{name:"word/document.xml",content:e}],["word/_rels/document.xml.rels",{name:"word/_rels/document.xml.rels",content:d}]]),binaryAssets:new Map}}function T(e,n){return e.parts.get(n)}function h(e,n){let t=new Map(e.parts);return t.set(n.name,n),{parts:t,binaryAssets:new Map(e.binaryAssets),...e.warnings&&e.warnings.length>0?{warnings:[...e.warnings]}:{}}}var i="http://schemas.openxmlformats.org/wordprocessingml/2006/main",l=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${i}">
  <w:body>
    <w:p><w:r><w:t/></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`,p=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,w=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,d=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;export{g as a,f as b,u as c,T as d,h as e};
