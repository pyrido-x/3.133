// ===== replay-viewer.js =====
// buildReplayHTML(data) — 生成自包含回放 HTML

function buildReplayHTML(data) {
    var cfg = data.cfg;
    var json = JSON.stringify(data);
    var pCfg = cfg.playerConfigs || {};
    var colors = {};
    for (var pid in pCfg) {
        if (pCfg[pid] && pCfg[pid].color) colors[pid] = pCfg[pid].color;
    }

    var H = [];

    // -- CSS --
    H.push('<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>回放 '+cfg.roomId+'</title><style>');
    H.push(':root{--w:#fff;--g:#bdbdbd;--b:#90caf9;--e:#a5d6a7;--c1:#b71c1c;--c2:#0d47a1;--c3:#1b5e20;--c4:#f57f17}');
    H.push('*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#e0e0e0;display:flex;flex-direction:column;height:100vh}');
    H.push('.tb{padding:6px 16px;background:#fff;border-bottom:2px solid #ccc;display:flex;align-items:center;gap:16px;flex-shrink:0;font-size:14px}');
    H.push('.tb b{font-size:15px}.tb em{font-size:18px;font-weight:bold;color:#e53935;font-style:normal}');
    H.push('.main{display:flex;flex:1;gap:20px;padding:15px;overflow:hidden;align-items:flex-start}');
    H.push('#gc{position:relative;display:inline-flex;border:2px solid #333;background:#999;flex-shrink:0}');
    H.push('#g{display:grid;gap:1px;user-select:none;-webkit-user-select:none}');
    H.push('#ps{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20}');
    H.push('.c{display:flex;align-items:center;justify-content:center;font-weight:bold;position:relative;cursor:default;overflow:hidden}');
    H.push('.c span{opacity:0;pointer-events:none}.c.kn span{opacity:1!important}');
    H.push('.tw{background:var(--w)}.tg{background:var(--g)}.tb{background:var(--b);color:#0d47a1}.te{background:var(--e);color:#1b5e20}');
    H.push('.po{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff!important;z-index:10;font-size:16px;text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:none}');
    H.push('.p1{background:var(--c1)!important}.p2{background:var(--c2)!important}.p3{background:var(--c3)!important}.p4{background:var(--c4)!important}');
    H.push('.do{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);z-index:10;font-size:14px;pointer-events:none}');
    H.push('.mo{position:absolute;inset:0;background:rgba(0,0,0,.15);pointer-events:none;z-index:5;border:2px dashed #000}');
    H.push('.side{width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:6px}');
    H.push('.ctrl{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#fff;padding:6px 10px;border:1px solid #ccc;border-radius:4px}');
    H.push('.ctrl button,.ctrl select{padding:4px 10px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer;font-size:13px}');
    H.push('.ctrl button:hover{background:#e0e0e0}.ctrl label{font-size:12px;display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap}');
    H.push('.info{background:#fff;padding:4px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center}');
    H.push('#lc{width:320px;height:500px;background:#fff;border:1px solid #ddd;overflow-y:auto;font-size:13px}');
    H.push('table{width:100%;border-collapse:collapse;text-align:center}');
    H.push('th{background:#f5f5f5;padding:8px;border-bottom:2px solid #ddd;position:sticky;top:0}');
    H.push('td{padding:6px;border-bottom:1px solid #eee}td.cur{background:#fff3e0}');
    H.push('@media(max-width:900px){.main{flex-direction:column;align-items:center}');
    H.push('</style></head><body>');

    // -- HTML 结构 --
    H.push('<div class="tb"><b>对局回放 '+cfg.roomId+'</b><em id="tl"></em><span id="cl" style="font-size:14px;color:#555"></span></div>');
    H.push('<div class="main">');
    H.push('<div id="gc"><div id="g"></div><svg id="ps"></svg></div>');
    H.push('<div class="side">');
    H.push('<div class="ctrl">');
    H.push('<button onclick="prv()">◀</button><button onclick="nxt()">▶</button>');
    H.push('<select id="vs" onchange="rf()"></select>');
    H.push('<label><input type="checkbox" id="sn" checked onchange="rf()">编号</label>');
    H.push('<label><input type="checkbox" id="sp" checked onchange="rf()">路径</label>');
    H.push('</div>');
    H.push('<div class="info" id="td"></div>');
    H.push('<div id="lc"><table><thead id="lth"></thead><tbody id="ltb"></tbody></table></div>');
    H.push('</div></div>');

    // -- JS --
    H.push('<script>');
    H.push('var DATA='+json+';');
    H.push('var STYLE='+JSON.stringify(colors)+';');
    H.push('(function(){');
    H.push('var D=DATA,S=D.snaps,G=D.grid,L=D.log,C=D.cfg,Z=D.names,N=C.mapSize,FI=1;');
    H.push('var CL=STYLE,AC=C.activeRoleIds||[];');
    H.push('var TR={white:"tw",gray:"tg",blue:"tb",green:"te"};');
    H.push('var el=function(id){return document.getElementById(id);};');
    H.push('var eh=function(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");};');

    // renderFrame
    H.push('function rf(){');
    H.push('var f=S[Math.min(FI,S.length-1)];if(!f)return;');
    H.push('var LIDX=f.t>0?f.t-1:0,isEnd=FI>=S.length-1;');
    H.push('el("tl").textContent="回合 "+(LIDX+1)+"/"+(L.length||"?");');
    H.push('el("cl").textContent="当前: "+(Z[f.cp]||"P"+f.cp);');
    H.push('var vs=el("vs"),pe=vs.value||"omni",om=pe==="omni";');
    H.push('var sN=el("sn").checked,sP=el("sp").checked;');
    H.push('var cs=N>20?Math.max(20,Math.floor(480/N)):50;');
    H.push('var gEl=el("g");gEl.style.gridTemplateColumns="repeat("+N+","+cs+"px)";');

    // Fog
    H.push('var pk={};if(!om&&f.players[pe]&&f.players[pe].knowledge){var ka=f.players[pe].knowledge;for(var ki=0;ki<ka.length;ki++)pk[ka[ki]]=true;}');
    H.push('var pd=!om&&f.players[pe]&&!f.players[pe].alive;');

    // Path data
    H.push('var pp={};if(sP){for(var pid in f.players){var ht=f.players[pid].history||[];if(ht.length<2)continue;var ws=om||pid===pe;if(pd)ws=true;if(ws){var pt=[];for(var hi=0;hi<ht.length;hi++)pt.push([ht[hi].r,ht[hi].c]);pp[pid]=pt;}}}');

    // Grid cells
    H.push('var gh="";');
    H.push('for(var r=0;r<N;r++){for(var c=0;c<N;c++){');
    H.push('var cl=(G[r]&&G[r][c])||{},ty=cl.type||"white",nm=cl.num!=null?cl.num:"";');
    H.push('var kn=om||pd||isEnd;if(!kn&&pk[r+","+c])kn=true;');
    H.push('var cla="c "+(TR[ty]||"tw")+(kn?" kn":"");');
    H.push('var sty="width:"+cs+"px;height:"+cs+"px;font-size:"+Math.floor(cs*0.32)+"px";');
    H.push('var ir="<span>"+nm+"</span>";');

    // Mines
    H.push('if(kn&&f.mines){for(var mi=0;mi<f.mines.length;mi++){');
    H.push('var m=f.mines[mi],ci=m.indexOf(":");if(ci<1)continue;');
    H.push('var mc=m.substring(ci+1).split(",");');
    H.push('if(parseInt(mc[0])===r&&parseInt(mc[1])===c){ir+="<div class=\\"mo\\"></div>";break;}');
    H.push('}}');

    // Players
    H.push('for(var pid in f.players){var p=f.players[pid];if(!p||p.r!==r||p.c!==c)continue;');
    H.push('var pn=parseInt(pid);if(p.alive){ir+="<div class=\\"po p"+pn+"\\">"+nm+"</div>";}');
    H.push('else{ir+="<div class=\\"do\\">☠</div>";}}');

    H.push('gh+="<div style=\\""+sty+"\\" class=\\""+cla+"\\">"+ir+"</div>";');
    H.push('}}');
    H.push('gEl.innerHTML=gh;');

    // SVG paths
    H.push('var svg=el("ps"),sw=N*cs;svg.setAttribute("viewBox","0 0 "+sw+" "+sw);svg.style.width=sw+"px";svg.style.height=sw+"px";');
    H.push('var sh="";');
    H.push('for(var pid in pp){var clr=CL[pid]||"#888",pt=pp[pid];if(!pt||pt.length<2)continue;');
    H.push('var d="M"+(pt[0][1]*cs+cs/2)+","+(pt[0][0]*cs+cs/2);');
    H.push('for(var j=1;j<pt.length;j++)d+=" L"+(pt[j][1]*cs+cs/2)+","+(pt[j][0]*cs+cs/2);');
    H.push('sh+="<polyline points=\\""+d+"\\" fill=\\"none\\" stroke=\\""+clr+"\\" stroke-width=\\"2\\" stroke-dasharray=\\"6,3\\" opacity=\\"0.8\\"/>";}');
    H.push('svg.innerHTML=sh;');

    // Status
    H.push('var td=el("td");');
    H.push('if(pd)td.innerHTML="<span style=\\"color:#f44336\\">已阵亡-全知视角</span>";');
    H.push('else if(om)td.innerHTML="<span style=\\"color:#333\\">全知视角</span>";');
    H.push('else td.innerHTML="<span style=\\"color:#4caf50\\">"+eh(Z[pe]||"P"+pe)+" 视角</span>";');

    // Log
    H.push('RL(LIDX);}');
    H.push('function RL(tn){');
    H.push('var th=el("lth"),hdr="<tr>";');
    H.push('for(var i=0;i<AC.length;i++)hdr+="<th style=\\"color:"+(CL[AC[i]]||"#333")+"\\">"+eh(Z[AC[i]]||"P"+AC[i])+"</th>";');
    H.push('th.innerHTML=hdr+"</tr>";');
    H.push('var tb=el("ltb"),htm="";');
    H.push('for(var t=0;t<=tn&&t<L.length;t++){');
    H.push('htm+="<tr>";');
    H.push('for(var j=0;j<AC.length;j++)htm+="<td"+(t===tn?" class=\\"cur\\"":"")+">"+eh(String(L[t][j]||""))+"</td>";');
    H.push('htm+="</tr>";}');
    H.push('tb.innerHTML=htm;');
    H.push('setTimeout(function(){var lc=el("lc");if(lc)lc.scrollTop=lc.scrollHeight;},50);}');
    H.push('function nxt(){if(FI<S.length-1){FI++;rf();}}');
    H.push('function prv(){if(FI>0){FI--;rf();}}');

    // Init
    H.push('el("vs").innerHTML="<option value=\\"omni\\">全知视角</option>";');
    H.push('for(var pid in C.playerConfigs){if(C.playerConfigs[pid]&&!C.playerConfigs[pid].isEmpty)el("vs").innerHTML+="<option value=\\""+pid+"\\">"+eh(Z[pid]||"P"+pid)+"</option>";}');
    H.push('document.addEventListener("keydown",function(e){if(e.key==="ArrowRight"){e.preventDefault();nxt();}if(e.key==="ArrowLeft"){e.preventDefault();prv();}});');
    H.push('FI=1;rf();');
    H.push('})();');
    H.push('</script></body></html>');
    return H.join('\n');
}
