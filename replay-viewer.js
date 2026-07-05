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
    H.push('<button id="btn-prev" onclick="PRV()">◀</button><button id="btn-next" onclick="NXT()">▶</button>');
    H.push('<select id="vs" onchange="render()"></select>');
    H.push('<label><input type="checkbox" id="sn" checked onchange="render()">编号</label>');
    H.push('<label><input type="checkbox" id="sp" checked onchange="render()">路径</label>');
    H.push('</div>');
    H.push('<div class="info" id="td"></div>');
    H.push('<div id="lc"><table><thead id="lth"></thead><tbody id="ltb"></tbody></table></div>');
    H.push('</div></div>');

    // -- JS --
    H.push('<script>');
    H.push('var DATA='+json+';');
    H.push('var STYLE='+JSON.stringify(colors)+';');
    H.push('var D=DATA,S=D.snaps,G=D.grid,L=D.log,C=D.cfg,Z=D.names,N=C.mapSize,FI=0;');
    H.push('var CL=STYLE,AC=C.activeRoleIds||[],TR={white:"tw",gray:"tg",blue:"tb",green:"te"};');
    H.push('function E(id){return document.getElementById(id);}');
    H.push('function EH(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}');
    H.push('function NXT(){if(FI<S.length-1){FI++;render();}}');
    H.push('function PRV(){if(FI>0){FI--;render();}}');
    H.push('document.addEventListener("keydown",function(e){if(e.key==="ArrowRight"){e.preventDefault();NXT();}if(e.key==="ArrowLeft"){e.preventDefault();PRV();}});');
    H.push('function render(){');
    H.push('var idx=Math.min(FI,S.length-1),f=S[idx];if(!f)return;');
    H.push('var logIdx=f.t>0?f.t-1:0,totalTurns=L.length||0;');
    H.push('if(FI===0){E("tl").textContent="初始状态 / 共"+totalTurns+"回合";}');
    H.push('else{E("tl").textContent="回合 "+(logIdx+1)+"/"+totalTurns;}');
    H.push('E("cl").textContent="当前: "+(Z[f.cp]||"P"+f.cp);');
    H.push('var vs=E("vs"),pe=vs?vs.value:"omni",om=pe==="omni";');
    H.push('var sN=E("sn").checked,sP=E("sp").checked;');
    H.push('var cs=N>20?Math.max(20,Math.floor(480/N)):50;');
    H.push('var gEl=E("g");gEl.style.gridTemplateColumns="repeat("+N+","+cs+"px)";');

    // Fog — per-player explored cells
    H.push('var pk={};');
    H.push('if(!om&&f.players[pe]&&f.players[pe].knowledge){');
    H.push('  var ka=f.players[pe].knowledge;for(var ki=0;ki<ka.length;ki++)pk[ka[ki]]=true;}');
    H.push('var pd=!om&&f.players[pe]&&!f.players[pe].alive;');
    H.push('var isEnd=FI>=S.length-1;');

    // Paths
    H.push('var pp={};if(sP){for(var pid in f.players){');
    H.push('var ht=f.players[pid].history||[];if(ht.length<2)continue;');
    H.push('var ws=om||pid===pe;if(pd)ws=true;if(ws){var pt=[];');
    H.push('for(var hi=0;hi<ht.length;hi++)pt.push([ht[hi].r,ht[hi].c]);pp[pid]=pt;}}}');

    // Grid
    H.push('var gh="";');
    H.push('for(var r=0;r<N;r++){for(var c=0;c<N;c++){');
    H.push('var cl=(G[r]&&G[r][c])||{},ty=cl.type||"white",nm=cl.num!=null?cl.num:"";');
    H.push('var kn=om||pd||isEnd;if(!kn&&pk[r+","+c])kn=true;');
    H.push('var c1="c "+(TR[ty]||"tw")+(kn?" kn":"");');
    H.push('var c2="width:"+cs+"px;height:"+cs+"px;font-size:"+Math.floor(cs*0.32)+"px";');
    H.push('var ir="<span>"+nm+"</span>";');
    // Mines
    H.push('if(kn&&f.mines){for(var mi=0;mi<f.mines.length;mi++){');
    H.push('var mk=f.mines[mi],ci=mk.indexOf(":");if(ci<1)continue;');
    H.push('var mc=mk.substring(ci+1).split(",");');
    H.push('if(parseInt(mc[0])===r&&parseInt(mc[1])===c){ir+="<div class=\\"mo\\"></div>";break;}}}');
    // Players
    H.push('for(var pid in f.players){var p=f.players[pid];if(!p||p.r!==r||p.c!==c)continue;');
    H.push('var pn=parseInt(pid);if(p.alive){ir+="<div class=\\"po p"+pn+"\\">"+nm+"</div>";}');
    H.push('else{ir+="<div class=\\"do\\">☠</div>";}}');
    H.push('gh+="<div style=\\""+c2+"\\" class=\\""+c1+"\\">"+ir+"</div>";');
    H.push('}}');
    H.push('gEl.innerHTML=gh;');

    // SVG
    H.push('var svg=E("ps"),sw=N*cs;svg.setAttribute("viewBox","0 0 "+sw+" "+sw);svg.style.width=sw+"px";svg.style.height=sw+"px";');
    H.push('var sh="";for(var pid in pp){var clr=CL[pid]||"#888",pt=pp[pid];if(!pt||pt.length<2)continue;');
    H.push('var d="M"+(pt[0][1]*cs+cs/2)+","+(pt[0][0]*cs+cs/2);');
    H.push('for(var j=1;j<pt.length;j++)d+=" L"+(pt[j][1]*cs+cs/2)+","+(pt[j][0]*cs+cs/2);');
    H.push('sh+="<polyline points=\\""+d+"\\" fill=\\"none\\" stroke=\\""+clr+"\\" stroke-width=\\"2\\" stroke-dasharray=\\"6,3\\" opacity=\\"0.8\\"/>";}');
    H.push('svg.innerHTML=sh;');

    // Status
    H.push('var td=E("td");');
    H.push('if(pd)td.innerHTML="<span style=\\"color:#f44336\\">已阵亡-全知视角</span>";');
    H.push('else if(FI===0)td.innerHTML="<span style=\\"color:#ff9800\\">初始状态</span>";');
    H.push('else if(om)td.innerHTML="<span style=\\"color:#333\\">全知视角</span>";');
    H.push('else td.innerHTML="<span style=\\"color:#4caf50\\">"+EH(Z[pe]||"P"+pe)+" 视角</span>";');

    // Log — only show entries up to current logIdx
    H.push('var th=E("lth"),hdr="<tr>";');
    H.push('for(var i=0;i<AC.length;i++)hdr+="<th style=\\"color:"+(CL[AC[i]]||"#333")+"\\">"+EH(Z[AC[i]]||"P"+AC[i])+"</th>";');
    H.push('th.innerHTML=hdr+"</tr>";');
    H.push('var tb=E("ltb"),htm="";');
    H.push('for(var t=0;t<=logIdx&&t<L.length;t++){');
    H.push('htm+="<tr>";var cur=(t===logIdx);');
    H.push('for(var j=0;j<AC.length;j++)htm+="<td"+(cur?" class=\\"cur\\"":"")+">"+EH(String(L[t][j]||""))+"</td>";');
    H.push('htm+="</tr>";}');
    H.push('if(L.length===0||logIdx<0)htm="<tr><td colspan="+AC.length+">等待对局开始…</td></tr>";');
    H.push('tb.innerHTML=htm;');
    H.push('setTimeout(function(){var lc=E("lc");if(lc)lc.scrollTop=lc.scrollHeight;},50);');

    // Button state
    H.push('E("btn-prev").disabled=(FI<=0);E("btn-next").disabled=(FI>=S.length-1);');
    H.push('}');

    // Init
    H.push('E("vs").innerHTML="<option value=\\"omni\\">全知视角</option>";');
    H.push('for(var pid in C.playerConfigs){if(C.playerConfigs[pid]&&!C.playerConfigs[pid].isEmpty)E("vs").innerHTML+="<option value=\\""+pid+"\\">"+EH(Z[pid]||"P"+pid)+"</option>";}');
    H.push('FI=0;render();');
    H.push('</script></body></html>');
    return H.join('\n');
}
