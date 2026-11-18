import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { patchOriginalPagination } from './patch-pagination.mjs'
import path from 'node:path'
const output=path.resolve('static/extend')
if(output!==path.join(process.cwd(),'static','extend'))throw new Error('Unexpected build output path')
rmSync(output,{recursive:true,force:true})
mkdirSync(output,{recursive:true})
await build({entryPoints:['frontend/src/preview.tsx'],bundle:true,format:'esm',splitting:true,outdir:'static/extend',entryNames:'preview',chunkNames:'chunks/[name]-[hash]',minify:true,jsx:'automatic',alias:{'@':path.resolve('frontend/src')},loader:{'.wasm':'file'},assetNames:'[name]-[hash]',define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked',plugins:[{name:'original-word-pagination',setup(plugin){plugin.onLoad({filter:/@extend-ai[\\/]react-docx[\\/]dist[\\/]index\.js$/},args=>({contents:patchOriginalPagination(readFileSync(args.path,'utf8')),loader:'js'}))}}]})
execFileSync(process.execPath,['node_modules/@tailwindcss/cli/dist/index.mjs','-i','frontend/src/preview.css','-o','static/extend/preview.css','--minify'],{stdio:'inherit'})
const source='node_modules/@extend-ai/react-docx/dist'
for(const name of readdirSync(source))if(name.endsWith('.wasm')||name.endsWith('-license.txt'))copyFileSync(path.join(source,name),path.join(output,name))
const licenses=path.join(output,'licenses')
mkdirSync(licenses,{recursive:true})
for(const entry of readdirSync('node_modules',{withFileTypes:true})){
 if(!entry.isDirectory()||entry.name.startsWith('.'))continue
 const packages=entry.name.startsWith('@')?readdirSync(path.join('node_modules',entry.name)).map(name=>`${entry.name}/${name}`):[entry.name]
 for(const pkg of packages)for(const name of readdirSync(path.join('node_modules',pkg)))if(/^(license|licence|notice)(\.|$)/i.test(name))copyFileSync(path.join('node_modules',pkg,name),path.join(licenses,`${pkg.replace('/','__')}-${name}`))
}
copyFileSync('frontend/EXTEND-LICENSE.md',path.join(licenses,'extend-ui-MIT.md'))
