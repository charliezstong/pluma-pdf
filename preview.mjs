import http from 'node:http';
import { readFile } from 'node:fs/promises';
http.createServer(async(req,res)=>{if(req.url!=='/'&&req.url!=='/index.html'){res.writeHead(404);res.end();return;}try{const html=await readFile(new URL('./dist/ui.html', import.meta.url));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);}catch{res.writeHead(503);res.end('Ejecuta npm run build primero.');}}).listen(3848,'127.0.0.1',()=>console.log('Vista de prueba: http://127.0.0.1:3848. Ctrl+C para cerrar.'));
