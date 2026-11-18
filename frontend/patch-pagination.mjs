// Limit the saved Word pagination policy to the original, read-only frame.
export function patchOriginalPagination(source) {
 const anchor='setModel(nextModel);'
 if(source.split(anchor).length!==2||!source.includes('function paragraphStartsWithLastRenderedPageBreak2('))throw new Error('Extend pagination patch no longer matches; review the pinned engine before building.')
 return source.replace(anchor,`if (new URLSearchParams(globalThis.location?.search ?? "").get("mode") === "viewer") {
   for (const paragraph of nextModel.nodes) {
     if (paragraph.type === "paragraph" && paragraphStartsWithLastRenderedPageBreak2(paragraph)) {
       paragraph.style = { ...paragraph.style, pageBreakBefore: true };
     }
   }
 }
 ${anchor}`)
}
