// replay-viewer.js — 完整对局回放 HTML 生成

function buildReplayHTML(data) {
    var cfg = data.cfg;
    var json = JSON.stringify(data);
    var colors = {};
    for (var pid in (cfg.playerConfigs||{})) {
        var pc = cfg.playerConfigs[pid];
        if (pc && pc.color) colors[pid] = pc.color;
    }

    var H = [];
    H.push('<!DOCTYPE html>');
    H.push('<html lang="zh"><head><meta charset="UTF-8"><title>回放 '+cfg.roomId+'</title>');
    H.push('<style>');
    H.push(':root{--w:#fff;--g:#bdbdbd;--b:#90caf9;--e:#a5d6a7;--c1:#b71c1c;--c2:#0d47a1;--c3:#1b5e20;--c4:#f57f17}');
    H.push('*{box-sizing:border-box;margin:0;padding:0}');
    H.push('body{font-family:Arial,sans-serif;background:#e0e0e0;display:flex;flex-direction:column;height:100vh}');
    H.push('.top{padding:6px 16px;background:#fff;border-bottom:2px solid #ccc;display:flex;align-items:center;gap:16px;flex-shrink:0;font-size:14px}');
    H.push('.top b{font-size:15px}.top em{font-size:18px;font-weight:bold;color:#e53935;font-style:normal}');
    H.push('.main{display:flex;flex:1;gap:20px;padding:15px;overflow:hidden;align-items:flex-start}');
    H.push('#gc{position:relative;display:inline-flex;border:2px solid #333;background:#999;flex-shrink:0}');
    H.push('#g{display:grid;gap:1px;user-select:none;-webkit-user-select:none}');
    H.push('#ps{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20}');
    H.push('.c{display:flex;align-items:center;justify-content:center;font-weight:bold;position:relative;cursor:default;font-size:14px}');
    H.push('.c span{opacity:0;pointer-events:none}.c.kn span{opacity:1!important}');
    H.push('.tw{background:var(--w)}.tg{background:var(--g)}.tb{background:var(--b);color:#0d47a1}.te{background:var(--e);color:#1b5e20}');
    H.push('.po{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff!important;z-index:10;font-size:16px;text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:none}');
    H.push('.p1{background:var(--c1)!important}.p2{background:var(--c2)!important}.p3{background:var(--c3)!important}.p4{background:var(--c4)!important}');
    H.push('.do{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);z-index:10;font-size:14px;pointer-events:none}');
    H.push('.mo{position:absolute;inset:0;background:rgba(0,0,0,.15);pointer-events:none;z-index:5;border:2px dashed #000}');
    H.push('.side{width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:6px}');
    H.push('.ctrl{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#fff;padding:6px 10px;border:1px solid #ccc;border-radius:4px}');
    H.push('.ctrl button,.ctrl select{padding:4px 10px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;font-family:inherit}');
    H.push('.ctrl button:hover{background:#e0e0e0}.ctrl label{font-size:12px;display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap}');
    H.push('.info{background:#fff;padding:4px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center}');
    H.push('#lc{width:320px;height:500px;background:#fff;border:1px solid #ddd;overflow-y:auto;font-size:13px}');
    H.push('table{width:100%;border-collapse:collapse;text-align:center}');
    H.push('th{background:#f5f5f5;padding:8px;border-bottom:2px solid #ddd;position:sticky;top:0}');
    H.push('td{padding:6px;border-bottom:1px solid #eee}td.cur{background:#fff3e0}');
    H.push('@media(max-width:900px){.main{flex-direction:column;align-items:center}}');
    H.push('</style></head><body>');
    H.push('<div class="top"><b>📋 对局回放 '+cfg.roomId+'</b><em id="tl"></em><span id="cl" style="font-size:14px;color:#555"></span></div>');
    H.push('<div class="main"><div id="gc"><div id="g"></div><svg id="ps"></svg></div>');
    H.push('<div class="side">');
    H.push('<div class="ctrl">');
    H.push('<button onclick="prv()" title="←">◀</button>');
    H.push('<button onclick="nxt()" title="→">▶</button>');
    H.push('<select id="vs" onchange="rf()"></select>');
    H.push('<label><input type="checkbox" id="sn" checked onchange="rf()">编号</label>');
    H.push('<label><input type="checkbox" id="sp" checked onchange="rf()">路径</label>');
    H.push('</div><div class="info" id="td"></div>');
    H.push('<div id="lc"><table><thead id="lth"></thead><tbody id="ltb"></tbody></table></div>');
    H.push('</div></div>');

    // ---- 用反引号模板字符串避免转义地狱 ----
    // 但为了兼容性，手动拼接
    H.push('<script>');
    H.push('(function(){');
    H.push('var D='+json+';');
    H.push('var S=D.snaps,G=D.grid,L=D.log,C=D.cfg,NM=D.names,N=C.mapSize,FI=1;');
    H.push('var CL='+JSON.stringify(colors)+',AC='+JSON.stringify(cfg.activeRoleIds||[])+';');
    H.push('var TR={white:"tw",gray:"tg",blue:"tb",green:"te"};');
    H.push('var el=function(id){return document.getElementById(id);};');
    H.push('var eh=function(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");};');

    // Main render
    H.push('function rf(){');
    H.push('var idx=Math.min(FI,S.length-1),f=S[idx];if(!f)return;');
    // t now means: last log row index that applies to this frame
    // f.t = gameActionLog.length (count). Convert: logIdx = max(0, f.t - 1)
    H.push('var logIdx=f.t>0?f.t-1:0;');
    H.push('var isLast=FI>=S.length-1;');
    H.push('el("tl").textContent="回合 "+(logIdx+1)+" / "+(L.length>0?L.length:"?");');
    H.push('el("cl").textContent="当前行动: "+(NM[f.cp]||("P"+f.cp));');
    H.push('var vs=el("vs"),pe=vs.value||"omni",om=(pe==="omni");');
    H.push('var sN=el("sn").checked,sP=el("sp").checked;');

    // Cell size
    H.push('var cs=N>20?Math.max(20,Math.floor(480/N)):50;');
    H.push('el("g").style.gridTemplateColumns="repeat("+N+","+cs+"px)";');

    // Fog: per-player explored cells
    H.push('var pk={};');
    H.push('if(!om&&f.players[pe]&&f.players[pe].knowledge){');
    H.push('for(var ki=0;ki<f.players[pe].knowledge.length;ki++)pk[f.players[pe].knowledge[ki]]=true;}');
    H.push('var pd=!om&&f.players[pe]&&!f.players[pe].alive;');

    // Paths (array of [r,c] per player)
    H.push('var pp={};');
    H.push('if(sP){for(var pid in f.players){');
    H.push('var ht=f.players[pid].history||[];if(ht.length<2)continue;');
    H.push('var ws=om||pid===pe;if(pd)ws=true;if(ws){');
    H.push('var pt=[];for(var hi=0;hi<ht.length;hi++)pt.push([ht[hi].r,ht[hi].c]);');
    H.push('pp[pid]=pt;}}}');

    // Grid
    H.push('var gh="";');
    H.push('for(var r=0;r<N;r++){for(var c=0;c<N;c++){');
    H.push('var cll=(G[r]&&G[r][c])||{};');
    H.push('var tr=cll.type||"white",nm=(cll.num!=null?cll.num:"");');
    H.push('var kn=om||pd||isLast;');
    H.push('if(!kn&&pk[r+","+c])kn=true;');
    H.push('var csCls="c "+(TR[tr]||"tw")+(kn?" kn":"");');
    H.push('var csSty="width:"+cs+"px;height:"+cs+"px;font-size:"+Math.floor(cs*0.32)+"px";');
    H.push('var inr="<span>"+(sN?nm:"")+"</span>";');

    // Mines
    H.push('if(kn&&f.mines&&f.mines.length){');
    H.push('for(var mi=0;mi<f.mines.length;mi++){');
    H.push('var mk=f.mines[mi];var ci=mk.indexOf(":");');
    H.push('if(ci>0){var mrc=mk.substring(ci+1).split(",");');
    H.push('if(parseInt(mrc[0])===r&&parseInt(mrc[1])===c){inr+="<div class=\'mo\'></div>";break;}}}}');

    // Players
    H.push('for(var pid in f.players){var p=f.players[pid];');
    H.push('if(!p||p.r!==r||p.c!==c)continue;');
    H.push('var pn=parseInt(pid);');
    H.push('if(p.alive){inr+="<div class=\'po p"+pn+"\'>"+nm+"</div>";}');
    H.push('else{inr+="<div class=\'do\'>&#x2620;</div>";}}');

    H.push('gh+="<div class=\'"+csCls+"\' style=\'"+csSty+"\'>"+inr+"</div>";');
    H.push('}}');
    H.push('el("g").innerHTML=gh;');

    // SVG paths
    H.push('var svg=el("ps"),sw=N*cs;');
    H.push('svg.setAttribute("viewBox","0 0 "+sw+" "+sw);');
    H.push('svg.style.width=sw+"px";svg.style.height=sw+"px";');
    H.push('var sh="";');
    H.push('for(var pid in pp){var clr=CL[pid]||"#888",ptt=pp[pid];');
    H.push('if(!ptt||ptt.length<2)continue;');
    H.push('var d="M"+(ptt[0][1]*cs+cs/2)+","+(ptt[0][0]*cs+cs/2);');
    H.push('for(var pi=1;pi<ptt.length;pi++)d+=" L"+(ptt[pi][1]*cs+cs/2)+","+(ptt[pi][0]*cs+cs/2);');
    H.push('sh+="<polyline points=\'"+d+"\' fill=\'none\' stroke=\'"+clr+"\' stroke-width=\'2\' stroke-dasharray=\'6,3\' opacity=\'0.8\"/>";}');
    H.push('svg.innerHTML=sh;');

    // Status text
    H.push('var tds="";');
    H.push('if(pd)tds="<span style=color:#f44336>💀 已阵亡 — 全知视角</span>";');
    H.push('else if(om)tds="<span style=color:#333>👁 全知视角</span>";');
    H.push('else tds="<span style=color:#4caf50>🫵 "+eh(NM[pe]||"P"+pe)+" 视角</span>";');
    H.push('el("td").innerHTML=tds;');

    // Render log
    H.push('rl(logIdx);');
    H.push('}');

    // Log function
    H.push('function rl(tn){');
    H.push('var th=el("lth"),hdr="<tr>";');
    H.push('for(var i=0;i<AC.length;i++){');
    H.push('hdr+="<th style=color:"+(CL[AC[i]]||"#333")+">"+eh(NM[AC[i]]||"P"+AC[i])+"</th>";}');
    H.push('th.innerHTML=hdr+"</tr>";');
    H.push('var tb=el("ltb"),htm="";');
    H.push('for(var t=0;t<=tn&&t<L.length;t++){');
    H.push('htm+="<tr>";');
    H.push('for(var j=0;j<AC.length;j++){');
    H.push('htm+="<td"+(t===tn?" class=cur":"")+">"+eh(String(L[t][j]||""))+"</td>";}');
    H.push('htm+="</tr>";}');
    H.push('tb.innerHTML=htm;');
    H.push('setTimeout(function(){var lc=el("lc");if(lc)lc.scrollTop=lc.scrollHeight;},50);}');

    // Navigation
    H.push('function nxt(){if(FI<S.length-1){FI++;rf();}}');
    H.push('function prv(){if(FI>0){FI--;rf();}}');

    // View dropdown
    H.push('var vs=el("vs");');
    H.push('vs.innerHTML="<option value=omni>👁 全知视角</option>";');
    H.push('for(var pid in C.playerConfigs){');
    H.push('if(C.playerConfigs[pid]&&!C.playerConfigs[pid].isEmpty)');
    H.push('vs.innerHTML+="<option value="+pid+">"+eh(NM[pid]||"P"+pid)+" 视角</option>";}');

    // Keyboard
    H.push('document.addEventListener("keydown",function(e){');
    H.push('if(e.key==="ArrowRight"){e.preventDefault();nxt();}');
    H.push('if(e.key==="ArrowLeft"){e.preventDefault();prv();}});');

    // Start at frame 1 (skip empty initial)
    H.push('FI=1;rf();');
    H.push('})();');
    H.push('</script></body></html>');

    return H.join('\n');
}
