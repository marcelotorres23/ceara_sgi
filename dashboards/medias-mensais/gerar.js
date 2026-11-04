/* Gera dados.json consolidado a partir de "REL.  MEN. DAS MEDIAS MENSAL.xlsx".
   Uso: node gerar.js [caminho-do-xlsx] [pasta-de-saida] */
const path=require('path');
const ExcelJS=require(process.env.EXCELJS_PATH||'exceljs');
const fs=require('fs');
const SRC=process.argv[2]||'A:/Ronald 2026/REL.  MEN. DAS MÉDIAS MENSAL.xlsx';
const OUT=process.argv[3]||path.join(__dirname,'site');
const SKIP=/^planilha/i;
const num=v=>{if(v&&typeof v==='object')v=v.result!==undefined?v.result:v.text;if(v===null||v===undefined||v==='')return null;const n=typeof v==='number'?v:parseFloat(String(v).replace(',','.'));return isFinite(n)?n:null;};
const txt=v=>{if(v&&typeof v==='object')v=v.result!==undefined?v.result:(v.text!==undefined?v.text:'');return v===null||v===undefined?'':String(v).trim().replace(/\s+/g,' ').toUpperCase();};
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
(async()=>{
const wb=new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);
const linhas=[];let descartadas=0;
wb.eachSheet(ws=>{
  if(SKIP.test(ws.name.trim()))return;
  if(!txt(ws.getCell(1,1).value).startsWith('DATA'))return;
  for(let r=2;r<=ws.rowCount;r++){
    const g=c=>ws.getCell(r,c).value;
    let d=g(1); if(d&&typeof d==='object'&&d.result!==undefined)d=d.result;
    const dt=d instanceof Date?d:(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}/.test(d)?new Date(d):null);
    const placa=txt(g(2)).replace(/[^A-Z0-9]/g,'');
    const motorista=norm(txt(g(3)));
    if(!dt||!placa||!motorista)continue;
    const rota=norm(txt(g(4)))||'NAO INFORMADA';
    const lts=num(g(5)),kmi=num(g(6)),kmf=num(g(7)),ideal=num(g(8));
    let km=num(g(10)); const horas=num(g(11))||0;
    if(!(km>0)&&kmf>kmi)km=kmf-kmi;
    if(!(lts>0)||!(km>0)){descartadas++;continue;}
    const media=km/lts;
    if(media<0.5||media>15){descartadas++;continue;}
    const iso=dt.toISOString().slice(0,10);
    linhas.push([iso,placa,motorista,rota,+lts.toFixed(2),Math.round(km),ideal>0?+ideal:null,+media.toFixed(3),horas]);
  }
});
linhas.sort((a,b)=>a[0].localeCompare(b[0]));
const dados={campos:['data','placa','motorista','rota','litros','km','objetivo','media','horas'],
 gerado_em:new Date().toISOString(),origem:path.basename(SRC),descartadas,linhas};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'dados.json'),JSON.stringify(dados));
const csv=[dados.campos.join(';')].concat(linhas.map(l=>l.map(v=>v===null?'':String(v).replace('.',',')).join(';')));
fs.writeFileSync(path.join(OUT,'base-consolidada.csv'),'\ufeff'+csv.join('\r\n'),'utf8');
console.log(`${linhas.length} viagens consolidadas, ${descartadas} descartadas -> ${OUT}`);
})();
