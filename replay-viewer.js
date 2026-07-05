// ===== 📋 replay-viewer.js - 对局回放浏览器 =====
// 由 exportGameData() 调用，读取全局 gameReplayData 生成自包含 HTML

function buildReplayHTML(data) {
    var cfg = data.cfg;
    var json = JSON.stringify(data);
    var colors = {}; var pCfg = cfg.playerConfigs || {};
    for (var pid in pCfg) { if (pCfg[pid] && pCfg[pid].color) colors[pid] = pCfg[pid].color; }

    var h = [];
    h.push('<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>回放 '+cfg.roomId+'</title><style>');
    h.push(':root{--white:#fff;--gray:#bdbdbd;--blue-med:#90caf9;--green-med:#a5d6a7;--c1:#b71c1c;--c2:#0d47a1;--c3:#1b5e20;--c4:#f57f17}');
    h.push('*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#e0e0e0;display:flex;flex-direction:column;height:100vh}');
    h.push('.top-bar{padding:6px 16px;background:#fff;border-bottom:2px solid #ccc;display:flex;align-items:center;gap:16px;flex-shrink:0;font-size:14px;flex-wrap:wrap}');
    h.push('.top-bar .title{font-weight:bold;font-size:15px}.top-bar .turn{font-size:18px;font-weight:bold;color:#e53935}');
    h.push('#main{display:flex;flex:1;gap:20px;padding:15px;overflow:hidden;align-items:flex-start}');
    h.push('#grid-container{position:relative;display:inline-flex;border:2px solid #333;background:#999;flex-shrink:0}');
    h.push('#grid{display:grid;gap:1px;user-select:none;-webkit-user-select:none}');
    h.push('#path-svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20}');
    h.push('.cell{width:50px;height:50px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:15px;position:relative;cursor:default}');
    h.push('.cell span{opacity:0;pointer-events:none}.cell.known span{opacity:1!important}');
    h.push('.terrain-white{background:var(--white)}.terrain-gray{background:var(--gray)}.terrain-blue{background:var(--blue-med);color:#0d47a1}.terrain-green{background:var(--green-med);color:#1b5e20}');
    h.push('.player-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:white!important;z-index:10;font-size:16px;text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:none}');
    h.push('.p1-bg{background:var(--c1)!important}.p2-bg{background:var(--c2)!important}.p3-bg{background:var(--c3)!important}.p4-bg{background:var(--c4)!important}');
    h.push('.dead-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);z-index:10;font-size:14px;pointer-events:none}');
    h.push('.mine-overlay{position:absolute;inset:0;background:rgba(0,0,0,.15);pointer-events:none;z-index:5;border:2px dashed #000}');
    h.push('.side-panel{width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:6px}');
    h.push('.ctrl-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#fff;padding:6px 10px;border:1px solid #ccc;border-radius:4px}');
    h.push('.ctrl-bar button,.ctrl-bar select{padding:4px 10px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;font-family:inherit}');
    h.push('.ctrl-bar button:hover{background:#e0e0e0}.ctrl-bar label{font-size:12px;display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap}');
    h.push('.turn-info{background:#fff;padding:4px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center}');
    h.push('#log-container{width:320px;height:500px;background:#fff;border:1px solid #ddd;overflow-y:auto;font-size:13px}');
    h.push('table{width:100%;border-collapse:collapse;text-align:center}th{background:#f5f5f5;padding:8px;border-bottom:2px solid #ddd;position:sticky;top:0}td{padding:6px;border-bottom:1px solid #eee}td.current{background:#fff3e0}');
    h.push('@media(max-width:900px){#main{flex-direction:column;align-items:center}}');
    h.push('</style></head><body>');

    h.push('<div class="top-bar"><span class="title">📋 对局回放 '+cfg.roomId+'</span>');
    h.push('<span class="turn" id="tl"></span><span id="cl" style="font-size:14px;color:#555"></span></div>');
    h.push('<div id="main">');
    h.push('<div id="grid-container"><div id="grid"></div><svg id="ps"></svg></div>');
    h.push('<div class="side-panel">');
    h.push('<div class="ctrl-bar">');
    h.push('<button onclick="prev()">◀</button><button onclick="next()">▶</button>');
    h.push('<select id="vs" onchange="rf()"></select>');
    h.push('<label><input type="checkbox" id="sn" checked onchange="rf()">编号</label>');
    h.push('<label><input type="checkbox" id="sp" checked onchange="rf()">路径</label>');
    h.push('</div>');
    h.push('<div class="turn-info" id="td"></div>');
    h.push('<div id="log-container"><table><thead id="lth"></thead><tbody id="ltb"></tbody></table></div>');
    h.push('</div></div>');

    h.push('<script>');
    h.push('var D='+json+';');
    h.push('var s=D.snaps,g=D.grid,l=D.log,C=D.cfg,n=D.names,N=C.mapSize,fi=0;');
    h.push('var CL='+JSON.stringify(colors)+',AC='+JSON.stringify(cfg.activeRoleIds||[])+';');
    h.push('var TR={white:"terrain-white",gray:"terrain-gray",blue:"terrain-blue",green:"terrain-green"};');

    h.push('function rf(){');
    h.push('var f=s[Math.min(fi,s.length-1)];if(!f)return;');
    h.push('var tn=f.t||0,go=fi===s.length-1;');
    h.push('document.getElementById("tl").textContent="回合 "+tn+"/"+(s.length-1||0);');
    h.push('document.getElementById("cl").textContent="行动: "+(n[f.cp]||"P"+f.cp);');
    h.push('var vs=document.getElementById("vs"),pe=vs?vs.value:"omni",om=pe==="omni";');
    h.push('var sN=document.getElementById("sn").checked,sP=document.getElementById("sp").checked;');
    h.push('var cs=N>20?Math.max(20,Math.floor(480/N)):50;');
    h.push('var gEl=document.getElementById("grid");gEl.style.gridTemplateColumns="repeat("+N+","+cs+"px)";');

    // Knowledge set for fog of war
    h.push('var pk={};if(!om&&f.players[pe]&&f.players[pe].knowledge){var ka=f.players[pe].knowledge;for(var ki=0;ki<ka.length;ki++)pk[ka[ki]]=true;}');
    h.push('var pd=!om&&f.players[pe]&&!f.players[pe].alive;');
    h.push('var pu=!om&&f.players[pe]&&f.players[pe].r<0;');

    // Path data
    h.push('var pp={};if(sP){for(var pid in f.players){var ht=f.players[pid].history||[];if(ht.length<2)continue;');
    h.push('var ws=om||pid===pe;if(pd)ws=true;if(ws){var pt=[];for(var hi=0;hi<ht.length;hi++)pt.push({r:ht[hi].r,c:ht[hi].c});pp[pid]=pt;}}}');

    // Grid cells
    h.push('var gh="";');
    h.push('for(var r=0;r<N;r++){for(var c=0;c<N;c++){');
    h.push('var cll=g[r][c]||{type:"white",num:""};var tr=cll.type||"white",nm=cll.num!=null?cll.num:"";');
    h.push('var kn=om||pd||go;if(!kn&&pk[r+","+c])kn=true;');
    h.push('var cls="cell "+TR[tr]+(kn?" known":"");');
    h.push('var inr="<span>"+nm+"</span>";if(sN)inr="<span style=opacity:"+(kn?1:.35)+">"+nm+"</span>";');

    // Mines
    h.push('if(kn&&f.mines){for(var mi=0;mi<f.mines.length;mi++){');
    h.push('var mk=f.mines[mi].split(":");if(mk.length>=2){var mc=mk[1].split(",");');
    h.push('if(parseInt(mc[0])===r&&parseInt(mc[1])===c){inr+="<div class=mine-overlay></div>";break;}}}}');

    // Players
    h.push('for(var pid in f.players){var p=f.players[pid];if(!p||p.r!==r||p.c!==c)continue;');
    h.push('var pn=parseInt(pid);if(p.alive){inr+="<div class=player-overlay p"+pn+"-bg>"+nm+"</div>";}');
    h.push('else{inr+="<div class=dead-overlay>☠</div>";}}');

    h.push('gh+="<div id=cell-"+r+"-"+c+" class="+cls+" style=width:"+cs+"px;height:"+cs+"px;font-size:"+Math.floor(cs*.32)+"px>"+inr+"</div>";');
    h.push('}}');
    h.push('gEl.innerHTML=gh;');

    // SVG paths
    h.push('var svg=document.getElementById("ps");svg.setAttribute("viewBox","0 0 "+(N*cs)+" "+(N*cs));svg.style.width=(N*cs)+"px";svg.style.height=(N*cs)+"px";');
    h.push('var sh="";for(var pid in pp){var clr=CL[pid]||"#888";var ptt=pp[pid];if(!ptt.length)continue;');
    h.push('var d="M"+ptt[0].c*cs+cs/2+","+ptt[0].r*cs+cs/2;');
    h.push('for(var pi2=1;pi2<ptt.length;pi2++)d+=" L"+ptt[pi2].c*cs+cs/2+","+ptt[pi2].r*cs+cs/2;');
    h.push('sh+="<polyline points="+d+" fill=none stroke="+clr+" stroke-width=2 stroke-dasharray=6,3 opacity=0.8 />";}');
    h.push('svg.innerHTML=sh;');

    // Status text
    h.push('var td2=document.getElementById("td");');
    h.push('if(pd)td2.innerHTML="<span style=color:#f44336>💀 已阵亡 — 全知视角</span>";');
    h.push('else if(pu)td2.innerHTML="<span style=color:#ff9800>👶 未出生</span>";');
    h.push('else if(om)td2.innerHTML="<span style=color:#333>👁 全知视角</span>";');
    h.push('else td2.innerHTML="<span style=color:#4caf50>🫵 "+eh(n[pe]||"P"+pe)+" 视角</span>";');

    h.push('rl(tn);}');

    // Log rendering
    h.push('function rl(tn){');
    h.push('var th=document.getElementById("lth");var hdr="<tr>";');
    h.push('for(var i=0;i<AC.length;i++){hdr+="<th style=color:"+(CL[AC[i]]||"#333")+">"+eh(n[AC[i]]||"P"+AC[i])+"</th>";}');
    h.push('th.innerHTML=hdr+"</tr>";');
    h.push('var tb=document.getElementById("ltb"),htm="";');
    h.push('for(var t=0;t<=tn&&t<l.length;t++){var e=l[t];htm+="<tr>";');
    h.push('for(var j=0;j<AC.length;j++){htm+="<td"+(t===tn?" class=current":"")+">"+eh(String(e[j]||""))+"</td>";}');
    h.push('htm+="</tr>";}');
    h.push('tb.innerHTML=htm;');
    h.push('setTimeout(function(){var lc=document.getElementById("log-container");if(lc)lc.scrollTop=lc.scrollHeight;},50);}');

    h.push('function eh(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}');
    h.push('function next(){if(fi<s.length-1){fi++;rf();}}function prev(){if(fi>0){fi--;rf();}}');

    // View dropdown
    h.push('var vs2=document.getElementById("vs");');
    h.push('vs2.innerHTML="<option value=omni>👁 全知视角</option>";');
    h.push('for(var pid in C.playerConfigs){if(C.playerConfigs[pid]&&!C.playerConfigs[pid].isEmpty)vs2.innerHTML+="<option value="+pid+">"+eh(n[pid]||"P"+pid)+" 视角</option>";}');

    h.push('document.addEventListener("keydown",function(e){if(e.key==="ArrowRight"){e.preventDefault();next();}if(e.key==="ArrowLeft"){e.preventDefault();prev();}});');
    h.push('fi=0;rf();');

    h.push('</script></body></html>');
    return h.join('\n');
}

// 由 index.html 的 exportGameData 调用此函数
// global: buildReplayHTML(data) → string
