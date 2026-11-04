/* Gera as versões derivadas de index.html:
   - dashboard-standalone.html : arquivo único, dados e logomarca embutidos
   - artifact.html             : mesmo conteúdo sem o esqueleto <html>/<head>/<body>
   Uso: node build.js   (rode depois de gerar.js) */
const fs=require('fs');
const path=require('path');
const p=f=>path.join(__dirname,f);
const s=f=>path.join(__dirname,'site',f);   /* site/ é o que vai para a Netlify */

const html=fs.readFileSync(s('index.html'),'utf8');
const dados=fs.readFileSync(s('dados.json'),'utf8');
const logo='data:image/png;base64,'+fs.readFileSync(s('logo-ceara.png')).toString('base64');

let std=html.replace('src="logo-ceara.png"','src="'+logo+'"');
if(std===html)throw new Error('tag da logomarca não encontrada em site/index.html');

const antes=std;
std=std.replace('<script>\nconst F={','<script>window.__DADOS_EMBUTIDOS='+dados+';<\/script>\n<script>\nconst F={');
if(std===antes)throw new Error('ponto de injeção dos dados não encontrado em site/index.html');
fs.writeFileSync(p('dashboard-standalone.html'),std);

const art=std.replace(/^[\s\S]*?<meta name="viewport"[^>]*>\n/,'')
             .replace(/<\/head>\s*<body>/,'')
             .replace(/<\/body>\s*<\/html>\s*$/,'');
if(/<!doctype|<html/i.test(art))throw new Error('sobrou esqueleto no artifact.html');
fs.writeFileSync(p('artifact.html'),art.trim()+'\n');

const kb=f=>Math.round(fs.statSync(p(f)).size/1024)+' KB';
console.log('dashboard-standalone.html '+kb('dashboard-standalone.html')+' · artifact.html '+kb('artifact.html'));
