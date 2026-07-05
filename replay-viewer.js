// ===== replay-viewer.js - 对局回放导出 =====

function buildReplayHTML(data) {
    var cfg = data.cfg;
    var json = JSON.stringify(data);
    var colors = {}; var pCfg = cfg.playerConfigs || {};
    for (var pid in pCfg) { if (pCfg[pid] && pCfg[pid].color) colors[pid] = pCfg[pid].color; }

    var c = [];
    c.push('<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>回放 '+cfg.roomId+'</title><style>');
    c.push(':root{--w:#fff;--g:#bdbdbd;--b:#90caf9;--e:#a5d6a7;--c1:#b71c1c;--c2:#0d47a1;--c3:#1b5e20;--c4:#f57f17}');
    c.push('*{box-sizing:border-box;margin:0;padding:0}');
    c.push('body{font-family:Arial,sans-serif;background:#e0e0e0;display:flex;flex-direction:column;height:100vh}');
    c.push('.top{padding:6px 16px;background:#fff;border-bottom:2px solid #ccc;display:flex;align-items:center;gap:16px;flex-shrink:0;font-size:14px}');
    c.push('.top .tt{font-weight:bold;font-size:15px}.top .tn{font-size:18px;font-weight:bold;color:#e53935}');
    c.push('.main{display:flex;flex:1;gap:20px;padding:15px;overflow:hidden;align-items:flex-start}');
    c.push('#gc{position:relative;display:inline-flex;border:2px solid #333;background:#999;flex-shrink:0}');
    c.push('#g{display:grid;gap:1px;user-select:none;-webkit-user-select:none}');
    c.push('#ps{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20}');
    c.push('.cel{display:flex;align-items:center;justify-content:center;font-weight:bold;position:relative;cursor:default}');
    c.push('.cel span{opacity:0;pointer-events:none}.cel.kn span{opacity:1!important}');
    c.push('.tw{background:var(--w)}.tg{background:var(--g)}.tb{background:var(--b);color:#0d47a1}.te{background:var(--e);color:#1b5e20}');
    c.push('.po{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff!important;z-index:10;font-size:16px;text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:none}');
    c.push('.p1b{background:var(--c1)!important}.p2b{background:var(--c2)!important}.p3b{background:var(--c3)!important}.p4b{background:var(--c4)!important}');
    c.push('.do{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);z-index:10;font-size:14px;pointer-events:none}');
    c.push('.mo{position:absolute;inset:0;background:rgba(0,0,0,.15);pointer-events:none;z-index:5;border:2px dashed #000}');
    c.push('.side{width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:6px}');
    c.push('.ctrl{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#fff;padding:6px 10px;border:1px solid #ccc;border-radius:4px}');
    c.push('.ctrl button,.ctrl select{padding:4px 10px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;font-family:inherit}');
    c.push('.ctrl button:hover{background:#e0e0e0}.ctrl label{font-size:12px;display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap}');
    c.push('.info{background:#fff;padding:4px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center}');
    c.push('#lc{width:320px;height:500px;background:#fff;border:1px solid #ddd;overflow-y:auto;font-size:13px}');
    c.push('table{width:100%;border-collapse:collapse;text-align:center}');
    c.push('th{background:#f5f5f5;padding:8px;border-bottom:2px solid #ddd;position:sticky;top:0}');
    c.push('td{padding:6px;border-bottom:1px solid #eee}td.cur{background:#fff3e0}');
    c.push('@media(max-width:900px){.main{flex-direction:column;align-items:center}}');
    c.push('</style></head><body>');
    c.push('<div class="top"><span class="tt">📋 对局回放 '+cfg.roomId+'</span><span class="tn" id="tl"></span><span id="cl" style="font-size:14px;color:#555"></span></div>');
    c.push('<div class="main">');
    c.push('<div id="gc"><div id="g"></div><svg id="ps"></svg></div>');
    c.push('<div class="side">');
    c.push('<div class="ctrl">');
    c.push('<button onclick="prv()">◀</button><button onclick="nxt()">▶</button>');
    c.push('<select id="vs" onchange="rf()"></select>');
    c.push('<label><input type="checkbox" id="sn" checked onchange="rf()">编号</label>');
    c.push('<label><input type="checkbox" id="sp" checked onchange="rf()">路径</label>');
    c.push('</div>');
    c.push('<div class="info" id="td"></div>');
    c.push('<div id="lc"><table><thead id="lth"></thead><tbody id="ltb"></tbody></table></div>');
    c.push('</div></div>');
    c.push('<script>');

    // Embed data
    c.push('var D='+json+';');
    c.push('var S=D.snaps,G=D.grid,L=D.log,C=D.cfg,NM=D.names,N=C.mapSize,FI=0;');
    c.push('var CL='+JSON.stringify(colors)+',AC='+JSON.stringify(cfg.activeRoleIds||[])+';');
    c.push('var TR={white:"tw",gray:"tg",blue:"tb",green:"te"};');

    // renderFrame
    c.push('function rf(){');
    c.push('var f=S[Math.min(FI,S.length-1)];if(!f)return;');
    c.push('var tn=f.t||0,go=FI===S.length-1;');
    c.push('E("tl").textContent="回合 "+tn+"/"+(S.length-1||0);');
    c.push('E("cl").textContent="行动: "+(NM[f.cp]||"P"+f.cp);');
    c.push('var vs=E("vs"),pe=vs?vs.value:"omni",om=pe==="omni";');
    c.push('var sN=E("sn").checked,sP=E("sp").checked;');
    c.push('var cs=N>20?Math.max(20,Math.floor(480/N)):50;');
    c.push('var gEl=E("g");gEl.style.gridTemplateColumns="repeat("+N+","+cs+"px)";');

    // Fog
    c.push('var pk={};if(!om&&f.players[pe]&&f.players[pe].knowledge){for(var ki=0;ki<f.players[pe].knowledge.length;ki++)pk[f.players[pe].knowledge[ki]]=true;}');
    c.push('var pd=!om&&f.players[pe]&&!f.players[pe].alive;');
    c.push('var pu=!om&&f.players[pe]&&f.players[pe].r<0;');

    // Paths
    c.push('var pp={};if(sP){for(var pid in f.players){var ht=f.players[pid].history||[];if(ht.length<2)continue;var ws=om||pid===pe;if(pd)ws=true;if(ws){var pt=[];for(var hi=0;hi<ht.length;hi++)pt.push([ht[hi].r,ht[hi].c]);pp[pid]=pt;}}}');

    // Grid cells
    c.push('var gh="";');
    c.push('for(var r=0;r<N;r++){for(var c=0;c<N;c++){');
    c.push('var cll=G[r][c]||{};var tr=cll.type||"white",nm=cll.num!=null?cll.num:"";');
    c.push('var kn=om||pd||go;if(!kn&&pk[r+","+c])kn=true;');
    c.push('var cls="cel "+TR[tr]+(kn?" kn":"");');
    c.push('var sz="width:"+cs+"px;height:"+cs+"px;font-size:"+Math.floor(cs*.32)+"px";');
    c.push('var inr="<span>"+nm+"</span>";if(sN)inr="<span style=\\"opacity:"+(kn?1:.35)+"\\">"+nm+"</span>";');
    // Mines
    c.push('if(kn&&f.mines){for(var mi=0;mi<f.mines.length;mi++){var mk=f.mines[mi].split(":");if(mk.length>=2){var mc=mk[1].split(",");if(parseInt(mc[0])===r&&parseInt(mc[1])===c){inr+="<div class=\\"mo\\"></div>";break;}}}}');
    // Players
    c.push('for(var pid in f.players){var p=f.players[pid];if(!p||p.r!==r||p.c!==c)continue;var pn=parseInt(pid);if(p.alive){inr+="<div class=\\"po p"+pn+"b\\">"+nm+"</div>";}else{inr+="<div class=\\"do\\">\\u2620</div>";}}');
    c.push('gh+="<div class=\\""+cls+"\\" style=\\""+sz+"\\">"+inr+"</div>";');
    c.push('}}');
    c.push('gEl.innerHTML=gh;');

    // SVG paths
    c.push('var svg=E("ps");var sw=N*cs;svg.setAttribute("viewBox","0 0 "+sw+" "+sw);svg.style.width=sw+"px";svg.style.height=sw+"px";');
    c.push('var svgh="";for(var pid in pp){var clr=CL[pid]||"#888";var ptt=pp[pid];if(!ptt.length)continue;var d="M"+ptt[0][1]*cs+cs/2+","+ptt[0][0]*cs+cs/2;for(var pi2=1;pi2<ptt.length;pi2++)d+=" L"+ptt[pi2][1]*cs+cs/2+","+ptt[pi2][0]*cs+cs/2;svgh+="<polyline points=\\""+d+"\\" fill=\\"none\\" stroke=\\""+clr+"\\" stroke-width=\\"2\\" stroke-dasharray=\\"6,3\\" opacity=\\"0.8\\"/>";}');
    c.push('svg.innerHTML=svgh;');

    // Status
    c.push('var td=E("td");if(pd)td.innerHTML="<span style=\\"color:#f44336\\">\\uD83D\\uDC80 已阵亡</span>";else if(pu)td.innerHTML="<span style=\\"color:#ff9800\\">\\uD83D\\uDC76 未出生</span>";else if(om)td.innerHTML="<span style=\\"color:#333\\">\\uD83D\\uDC41 全知视角</span>";else td.innerHTML="<span style=\\"color:#4caf50\\">\\uD83E\\uDEF5 "+EH(NM[pe]||"P"+pe)+" 视角</span>";');
    c.push('RL(tn);}');

    // Log
    c.push('function RL(tn){var th=E("lth"),hdr="<tr>";for(var i=0;i<AC.length;i++){hdr+="<th style=\\"color:"+(CL[AC[i]]||"#333")+"\\">"+EH(NM[AC[i]]||"P"+AC[i])+"</th>";}th.innerHTML=hdr+"</tr>";var tb=E("ltb"),htm="";for(var t=0;t<=tn&&t<L.length;t++){htm+="<tr>";for(var j=0;j<AC.length;j++){var isC=t===tn;htm+="<td"+(isC?" class=\\"cur\\"":"")+">"+EH(String(L[t][j]||""))+"</td>";}htm+="</tr>";}tb.innerHTML=htm;setTimeout(function(){var lc=E("lc");if(lc)lc.scrollTop=lc.scrollHeight;},50);}');
    c.push('function E(id){return document.getElementById(id);}');
    c.push('function EH(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}');
    c.push('function nxt(){if(FI<S.length-1){FI++;rf();}}');
    c.push('function prv(){if(FI>0){FI--;rf();}}');
    c.push('var vs2=E("vs");vs2.innerHTML="<option value=\\"omni\\">\\uD83D\\uDC41 全知视角</option>";for(var pid in C.playerConfigs){if(C.playerConfigs[pid]&&!C.playerConfigs[pid].isEmpty)vs2.innerHTML+="<option value=\\""+pid+"\\">"+EH(NM[pid]||"P"+pid)+" 视角</option>";}');
    c.push('document.addEventListener("keydown",function(e){if(e.key==="ArrowRight"){e.preventDefault();nxt();}if(e.key==="ArrowLeft"){e.preventDefault();prv();}});');
    c.push('FI=0;rf();');
    c.push('</script></body></html>');
    return c.join('\n');
}
