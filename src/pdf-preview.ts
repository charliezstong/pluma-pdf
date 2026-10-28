import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Bundled into the UI: no worker URL, CDN or network request is needed.
// @ts-expect-error PDF.js ships no declaration for the worker entrypoint.
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

(globalThis as typeof globalThis & {pdfjsWorker?:unknown}).pdfjsWorker = { WorkerMessageHandler };

/** Render the actual PDF bytes so the comparison represents the exported file. */
export async function renderPdf(bytes:Uint8Array,maxWidth:number):Promise<{dataUrl:string;width:number;height:number}>{
  if(!Number.isFinite(maxWidth)||maxWidth<1||maxWidth>8192)throw new Error('Tamaño de previsualización inválido.');
  const task=getDocument({data:bytes.slice(),useWorkerFetch:false,useSystemFonts:true,useWasm:false,verbosity:VerbosityLevel.ERRORS});
  let canvas:HTMLCanvasElement|undefined;
  try{
    const pdf=await task.promise;
    if(!pdf.numPages)throw new Error('El PDF no contiene páginas.');
    const page=await pdf.getPage(1);const natural=page.getViewport({scale:1});
    const scale=Math.min(maxWidth/natural.width,8192/natural.height,Math.sqrt(24_000_000/(natural.width*natural.height)));
    const viewport=page.getViewport({scale});canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo crear la vista previa.');
    await page.render({canvas,canvasContext:ctx,viewport,background:'#ffffff'}).promise;
    return {dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
  }finally{if(canvas)canvas.width=canvas.height=1;await task.destroy();}
}
