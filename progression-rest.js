// ==========================================
// progression-rest.js — 完整重写
// 架构：SupabaseREST → ProgressionManager → AuthManager → Lottery
// ==========================================

function _yesterday(){var d=new Date();d.setDate(d.getDate()-1);return d.toISOString().split('T')[0];}
function _today(){return new Date().toISOString().split('T')[0];}

// ══════════════════════════════════════
//  Supabase REST — 纯 fetch
// ══════════════════════════════════════
var SupabaseREST = {
    url: 'https://aafzofowmxwelamizqdb.supabase.co',
    anonKey: 'sb_publishable_a37aZUSE9_nd7CWibu5E7A_1IXx4T3K',
    token: null,

    _headers: function(){
        var h={'apikey':this.anonKey,'Content-Type':'application/json'};
        if(this.token)h['Authorization']='Bearer '+this.token;
        return h;
    },
    dbGet: async function(table,id){
        try{
            var r=await fetch(this.url+'/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id),{headers:this._headers()});
            if(!r.ok){console.log('dbGet '+table+' status='+r.status);return null;}
            var a=await r.json();
            var result=a&&a.length?a[0]:null;
            if(!result)console.log('dbGet '+table+' empty for id='+id.substring(0,8)+'...');
            return result;
        }catch(e){console.log('dbGet error:',e.message);return null;}
    },
    dbUpsert: async function(table,row){
        try{
            var r=await fetch(this.url+'/rest/v1/'+table,{method:'POST',headers:Object.assign({},this._headers(),{'Prefer':'resolution=merge-duplicates'}),body:JSON.stringify(row)});
            return r.ok;
        }catch(e){return false;}
    },
    nickExists: async function(name){
        try{var r=await fetch(this.url+'/rest/v1/nicknames?nickname=eq.'+encodeURIComponent(name),{headers:this._headers()});if(!r.ok)return false;var a=await r.json();return a&&a.length>0;}catch(e){return false;}
    },
    nickClaim: async function(name,pid){
        try{var r=await fetch(this.url+'/rest/v1/nicknames',{method:'POST',headers:this._headers(),body:JSON.stringify({nickname:name,player_id:pid})});return r.ok;}catch(e){return false;}
    },
    signup: async function(e,p){
        var r=await fetch(this.url+'/auth/v1/signup',{method:'POST',headers:this._headers(),body:JSON.stringify({email:e,password:p})});
        var d=await r.json();
        if(r.ok&&d.access_token){this.token=d.access_token;return{ok:true,user:d.user};}
        return{ok:false,error:d.msg||d.message||'Signup failed'};
    },
    login: async function(e,p){
        var r=await fetch(this.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:this._headers(),body:JSON.stringify({email:e,password:p})});
        var d=await r.json();
        if(r.ok&&d.access_token){this.token=d.access_token;return{ok:true,user:d.user};}
        return{ok:false,error:d.error_description||d.msg||'Login failed'};
    },
    getUser: async function(){
        if(!this.token)return null;
        try{var r=await fetch(this.url+'/auth/v1/user',{headers:this._headers()});if(!r.ok)return null;return await r.json();}catch(e){return null;}
    },
    logout: function(){this.token=null;},
    ready: function(){return!!this.url&&!!this.anonKey;}
};

// ══════════════════════════════════════
//  ProgressionManager
// ══════════════════════════════════════
var ProgressionManager = (function(){
    var LEVELS = [
        {xp:0,title:'新兵'},{xp:100,title:'见习'},{xp:250,title:'列兵'},{xp:450,title:'上等兵'},
        {xp:700,title:'下士'},{xp:1000,title:'中士'},{xp:1400,title:'上士'},{xp:1900,title:'军士长'},
        {xp:2500,title:'少尉'},{xp:3200,title:'中尉'},{xp:4000,title:'上尉'},{xp:5000,title:'少校'},
        {xp:6200,title:'中校'},{xp:7600,title:'上校'},{xp:9200,title:'大校'},{xp:11000,title:'准将'},
        {xp:13000,title:'少将'},{xp:15500,title:'中将'},{xp:18500,title:'上将'},{xp:22000,title:'大将'},
        {xp:26000,title:'元帅'},{xp:31000,title:'战争领主'},{xp:37000,title:'传奇'},{xp:44000,title:'史诗'},
        {xp:52000,title:'神话'},{xp:62000,title:'不朽'},{xp:74000,title:'战神'},{xp:88000,title:'半神'},
        {xp:105000,title:'神谕'},{xp:125000,title:'创世'}
    ];
    var ACHIEVEMENTS = {
        first_win:{name:'初尝胜果',desc:'赢得第一场对局',icon:'🏆'},win_10:{name:'十胜将军',desc:'累计赢得10场对局',icon:'⚔️'},
        win_50:{name:'五十胜王',desc:'累计赢得50场对局',icon:'👑'},stomp_10:{name:'暗杀者',desc:'踩死10个敌人',icon:'🥷'},
        stomp_50:{name:'近战大师',desc:'踩死50个敌人',icon:'🗡️'},blast_10:{name:'远程炮手',desc:'轰杀10个敌人',icon:'💥'},
        blast_50:{name:'毁灭者',desc:'轰杀50个敌人',icon:'🔥'},mine_10:{name:'地雷专家',desc:'用地雷炸死10个敌人',icon:'💣'},
        mine_50:{name:'雷神',desc:'用地雷炸死50个敌人',icon:'☠️'},tree_jump_50:{name:'森林之子',desc:'树闪使用50次',icon:'🌳'},
        tree_jump_200:{name:'树灵',desc:'树闪使用200次',icon:'🌿'},blink_50:{name:'闪现者',desc:'闪使用50次',icon:'⚡'},
        blink_200:{name:'时空行者',desc:'闪使用200次',icon:'🌀'},mines_placed_30:{name:'布雷手',desc:'埋设30颗地雷',icon:'📌'},
        mines_defused_20:{name:'拆弹专家',desc:'拆除20颗地雷',icon:'🔧'},sp_500:{name:'能源收集者',desc:'累计获得500SP',icon:'🔋'},
        sp_2000:{name:'能源大亨',desc:'累计获得2000SP',icon:'💰'},streak_3:{name:'三连胜',desc:'达成3连胜',icon:'🔥'},
        streak_5:{name:'五连胜',desc:'达成5连胜',icon:'💫'},streak_10:{name:'十连胜',desc:'达成10连胜',icon:'🌟'},
        grand_slam:{name:'大满贯',desc:'一局内用三种方式击杀',icon:'🎯'},ghost:{name:'幽灵',desc:'全程未暴露视野并击杀敌人',icon:'👻'},
        survivor:{name:'幸存者',desc:'单局存活超过35回合',icon:'🛡️'},
        tianhu:{name:'天胡',desc:'第一回合踩死敌人',icon:'🌅'},dihu:{name:'地胡',desc:'第一回合被敌人踩死',icon:'🌑'},
        omniscient:{name:'全知者',desc:'探索过地图中的每一格',icon:'🧠',hidden:true},
        caged:{name:'囚笼',desc:'触发被困死',icon:'⛓️',hidden:true},
        ascetic:{name:'苦行者',desc:'不使用技能获胜且回合≥15',icon:'🧘',hidden:true}
    };
    var DAILY_TEMPLATES = [
        {id:'kill_any_3',desc:'击杀3个敌人',target:3},{id:'kill_stomp_2',desc:'踩死2个敌人',target:2},
        {id:'kill_blast_2',desc:'使用轰击杀2次',target:2},{id:'kill_mine_1',desc:'用地雷炸死1个敌人',target:1},
        {id:'win_1',desc:'赢得1场对局',target:1},{id:'place_mines_5',desc:'埋设5颗地雷',target:5},
        {id:'defuse_3',desc:'拆除3颗地雷',target:3},{id:'use_blink_5',desc:'使用闪5次',target:5},
        {id:'use_tree_jump_5',desc:'使用树闪5次',target:5},{id:'use_blast_3',desc:'使用轰3次',target:3},
        {id:'explore_20',desc:'探索20个新格子',target:20},{id:'earn_sp_30',desc:'获得30点SP',target:30},
        {id:'survive_15',desc:'单局存活15回合',target:1},{id:'play_3',desc:'完成3场对局',target:3}
    ];
    var RANK_LABELS = {bronze:'🟤 青铜',silver:'⚪ 白银',gold:'🟡 黄金',platinum:'🟣 铂金',diamond:'💎 钻石',master:'👑 大师',grandmaster:'🌟 宗师'};
    var RANK_THRESHOLDS = [{tier:'bronze',min:0},{tier:'silver',min:250},{tier:'gold',min:450},{tier:'platinum',min:700},{tier:'diamond',min:1000},{tier:'master',min:1400},{tier:'grandmaster',min:1900}];

    // ── 内部状态 ──
    var data = null;           // 当前数据
    var authUid = null;        // Supabase 用户 UUID（null=游客）
    var saveTimer = 0;

    // ── 数据工厂 ──
    function emptyData(){
        return {
            xp:0,level:1,gamesPlayed:0,gamesWon:0,winStreak:0,bestWinStreak:0,
            coins:0,dailyCheckinDate:'',checkinStreak:0,dailyGameCoins:0,dailyGameCoinDate:'',
            email:'',nickname:'',
            rankScore:100,rankTier:'bronze',seasonGames:0,seasonWins:0,seasonStart:'',
            stats:{killsStomp:0,killsMine:0,killsBlast:0,deaths:0,minesPlaced:0,minesDefused:0,
                   blinksUsed:0,treeJumpsUsed:0,blastsUsed:0,totalSPEarned:0,totalCellsExplored:0,mudHits:0},
            achievements:{},dailyChallenges:null,
            _sess:{stomp:0,mine:0,blast:0,explored:0,turns:0,steppedOn:false,seenByEnemy:false,
                   sp:0,minesPl:0,minesDf:0,blinks:0,treeJumps:0,blasts:0,firstTurn:true,
                   usedSkill:false,stuckDeath:false,won:false,_mapCells:100}
        };
    }

    // ── 缓存 ──
    function cacheSave(){
        try{
            var o={}; for(var k in data){if(k!=='_sess')o[k]=data[k];}
            sessionStorage.setItem('prog_cache',JSON.stringify(o));
        }catch(e){}
    }
    function cacheLoad(){
        try{var r=sessionStorage.getItem('prog_cache');return r?JSON.parse(r):null;}catch(e){return null;}
    }

    // ── 云端读写 ──
    async function cloudLoad(){
        if(!SupabaseREST.ready()||!SupabaseREST.token||!authUid)return null;
        return await SupabaseREST.dbGet('player_progress',authUid);
    }
    async function cloudSave(row){
        if(!SupabaseREST.ready()||!SupabaseREST.token)return false;
        var r={id:authUid,xp:row.xp,level:row.level,games_played:row.gamesPlayed,games_won:row.gamesWon,
               win_streak:row.winStreak,best_win_streak:row.bestWinStreak,coins:row.coins,
               daily_checkin_date:row.dailyCheckinDate,checkin_streak:row.checkinStreak,
               daily_game_coins:row.dailyGameCoins,daily_game_coin_date:row.dailyGameCoinDate,
               email:row.email,nickname:row.nickname,
               rank_score:row.rankScore,rank_tier:row.rankTier,season_games:row.seasonGames,
               season_wins:row.seasonWins,season_start:row.seasonStart,
               stats:row.stats,achievements:row.achievements,daily_challenges:row.dailyChallenges,
               updated_at:new Date().toISOString()};
        return await SupabaseREST.dbUpsert('player_progress',r);
    }

    // ── 从云行加载 ──
    function applyRow(row){
        var d=emptyData(),sn=data&&data.nickname?data.nickname:'';
        d.xp=row.xp||0; d.level=row.level||1; d.gamesPlayed=row.games_played||0; d.gamesWon=row.games_won||0;
        d.winStreak=row.win_streak||0; d.bestWinStreak=row.best_win_streak||0; d.coins=row.coins||0;
        // 🌟 兼容缓存(camelCase)和云(snake_case)
        d.dailyCheckinDate=row.daily_checkin_date||row.dailyCheckinDate||'';
        d.checkinStreak=row.checkin_streak||row.checkinStreak||0;
        d.dailyGameCoins=row.daily_game_coins||row.dailyGameCoins||0; d.dailyGameCoinDate=row.daily_game_coin_date||row.dailyGameCoinDate||'';
        d.email=row.email||''; d.nickname=row.nickname||sn;
        d.rankScore=row.rank_score!=null?row.rank_score:100; d.rankTier=row.rank_tier||row.rankTier||'bronze';
        d.seasonGames=row.season_games||row.seasonGames||0; d.seasonWins=row.season_wins||row.seasonWins||0; d.seasonStart=row.season_start||row.seasonStart||'';
        if(row.stats)d.stats=row.stats;
        if(row.achievements)d.achievements=row.achievements;
        if(row.daily_challenges||row.dailyChallenges)d.dailyChallenges=row.daily_challenges||row.dailyChallenges;
        d._sess=data?data._sess:emptyData()._sess;
        data=d;
        _checkDaily();_maybeStartSeason();
    }

    // ── 初始化加载 ──
    async function load(){
        // 1. 云（token 过期可能 403，忽略错误走缓存）
        if(authUid&&SupabaseREST.token){
            try{
                var row=await cloudLoad();
                if(row){applyRow(row); console.log('☁️ 云加载, nick='+data.nickname); return;}
            }catch(e){console.log('⚠️ 云加载失败');}
        }
        // 2. 缓存
        var c=cacheLoad();
        if(c){data=emptyData();data._sess=emptyData()._sess;applyRow(c); console.log('💾 缓存'); return;}
        // 3. 空
        data=emptyData();data._sess=emptyData()._sess;
        _checkDaily(); // 🌟 空数据也要初始化每日挑战
        console.log('📦 默认数据');
    }

    // ── 保存 ──
    function doSave(){
        cacheSave();
        clearTimeout(saveTimer);
        saveTimer=setTimeout(function(){
            if(authUid&&SupabaseREST.token) cloudSave(data);
        },1500);
    }
    async function saveNow(){
        clearTimeout(saveTimer);
        cacheSave();
        if(authUid&&SupabaseREST.token) await cloudSave(data);
    }

    // ── 日常 ──
    function _checkDaily(){
        var today=_today();
        if(!data.dailyChallenges||data.dailyChallenges.date!==today){
            var pool=[].concat(DAILY_TEMPLATES),chosen=[];
            for(var i=0;i<3&&pool.length;i++){var idx=Math.floor(Math.random()*pool.length);chosen.push(Object.assign({},pool.splice(idx,1)[0],{progress:0,completed:false,claimed:false}));}
            data.dailyChallenges={date:today,challenges:chosen};
        }
    }
    function _getSeasonKey(){var d=new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);}
    function _maybeStartSeason(){
        var k=_getSeasonKey();
        if(!data.seasonStart||data.seasonStart!==k){data.seasonStart=k;data.rankScore=100;data.rankTier='bronze';data.seasonGames=0;data.seasonWins=0;}
    }
    function _computeRank(s){for(var i=RANK_THRESHOLDS.length-1;i>=0;i--){if(s>=RANK_THRESHOLDS[i].min)return RANK_THRESHOLDS[i].tier;}return'bronze';}

    // ── XP/Coin ──
    function addXP(amount){
        var oldLv=data.level; data.xp+=amount;
        var nl=1; for(var i=LEVELS.length-1;i>=0;i--){if(data.xp>=LEVELS[i].xp){nl=i+1;break;}}
        data.level=Math.min(nl,LEVELS.length);
        if(data.level>oldLv){for(var lv=oldLv+1;lv<=data.level;lv++)_toast('🎉 等级提升！','Lv.'+lv+' '+LEVELS[lv-1].title,'#4caf50');}
        doSave();refreshUI();
    }
    function addCoins(amount,reason){
        data.coins+=amount; doSave();
        if(amount>0)_toast('🪙 +'+amount+' Coin',reason||'','#ff9800');
        refreshUI();
    }
    function getLevelInfo(){
        var lv=Math.min(data.level,LEVELS.length),cur=LEVELS[lv-1],nxt=lv<LEVELS.length?LEVELS[lv]:null;
        var into=data.xp-cur.xp,need=nxt?nxt.xp-cur.xp:0;
        return{level:lv,title:cur.title,xp:data.xp,xpIntoLevel:into,xpNeeded:need,
               progress:nxt?Math.min(100,Math.round(into/need*100)):100,nextTitle:nxt?nxt.title:'MAX'};
    }

    // ── 成就 ──
    function checkAch(){
        var s=data.stats,sess=data._sess;
        var checks={
            first_win:data.gamesWon>=1,win_10:data.gamesWon>=10,win_50:data.gamesWon>=50,
            stomp_10:s.killsStomp>=10,stomp_50:s.killsStomp>=50,blast_10:s.killsBlast>=10,blast_50:s.killsBlast>=50,
            mine_10:s.killsMine>=10,mine_50:s.killsMine>=50,tree_jump_50:s.treeJumpsUsed>=50,tree_jump_200:s.treeJumpsUsed>=200,
            blink_50:s.blinksUsed>=50,blink_200:s.blinksUsed>=200,mines_placed_30:s.minesPlaced>=30,mines_defused_20:s.minesDefused>=20,
            sp_500:s.totalSPEarned>=500,sp_2000:s.totalSPEarned>=2000,streak_3:data.bestWinStreak>=3,
            streak_5:data.bestWinStreak>=5,streak_10:data.bestWinStreak>=10,
            grand_slam:sess.stomp>0&&sess.mine>0&&sess.blast>0,
            ghost:!sess.seenByEnemy&&(sess.stomp>0||sess.mine>0||sess.blast>0),
            survivor:sess.turns>=35,tianhu:sess.firstTurn&&sess.stomp>0,dihu:sess.firstTurn&&sess.steppedOn,
            omniscient:sess.explored>=sess._mapCells,caged:sess.stuckDeath,
            ascetic:sess.won&&!sess.usedSkill&&sess.turns>=15
        };
        for(var key in checks){if(checks[key]&&!data.achievements[key]){data.achievements[key]={unlockedAt:Date.now()};var a=ACHIEVEMENTS[key];_toast(a.icon+' 成就解锁！',a.name+' — '+a.desc,'#ff9800');addXP(30);}}
        doSave();
    }
    function checkDaily(){
        if(!data.dailyChallenges)return;var s=data._sess;
        for(var i=0;i<data.dailyChallenges.challenges.length;i++){var ch=data.dailyChallenges.challenges[i];if(ch.completed)continue;var p=0;switch(ch.id){case'kill_any_3':p=s.stomp+s.mine+s.blast;break;case'kill_stomp_2':p=s.stomp;break;case'kill_blast_2':p=s.blast;break;case'kill_mine_1':p=s.mine;break;case'win_1':p=data.gamesWon;break;case'place_mines_5':p=s.minesPl;break;case'defuse_3':p=s.minesDf;break;case'use_blink_5':p=s.blinks;break;case'use_tree_jump_5':p=s.treeJumps;break;case'use_blast_3':p=s.blasts;break;case'explore_20':p=s.explored;break;case'earn_sp_30':p=s.sp;break;case'survive_15':p=s.turns>=15?1:0;break;case'play_3':p=data.gamesPlayed;break;}ch.progress=Math.min(ch.target,p);if(ch.progress>=ch.target)ch.completed=true;}
        doSave();
    }

    // ── 段位 ──
    function rankedGame(won){
        _maybeStartSeason();data.seasonGames++;
        var placement=data.seasonGames<=5;
        if(won){data.seasonWins++;data.rankScore+=placement?40:25;}
        else{data.rankScore=Math.max(0,data.rankScore-(placement?5:15));}
        data.rankTier=_computeRank(data.rankScore);
        if(data.seasonGames===6)_toast('📊 定级赛完成！',RANK_LABELS[data.rankTier]||'','#ffd700');
    }

    // ── UI ──
    function refreshUI(){
        var info=getLevelInfo();
        var b=document.getElementById('player-level-badge');if(b)b.innerHTML='Lv.'+info.level+' <span style="font-size:10px;opacity:0.8">'+info.title+'</span>';
        var bar=document.getElementById('xp-bar-fill');if(bar){bar.style.width=info.progress+'%';bar.title=info.xpIntoLevel+'/'+info.xpNeeded+' XP';}
        var xpt=document.getElementById('xp-text');if(xpt)xpt.textContent=info.nextTitle!=='MAX'?info.xpIntoLevel+'/'+info.xpNeeded+' XP → '+info.nextTitle:'已达最高等级';
        var cd=document.getElementById('coin-display');if(cd)cd.innerHTML='🪙 '+data.coins;

        var isLogin=!!(authUid&&SupabaseREST.token);
        var rk=document.getElementById('rank-display');if(rk)rk.innerHTML=isLogin?((RANK_LABELS[data.rankTier]||'🟤 青铜')+' <span style="font-size:9px;opacity:0.7">'+data.rankScore+'分</span>'):'👤 游客';
        var rbm=document.getElementById('rank-badge-mini');if(rbm)rbm.textContent=isLogin?'🏆 段位':'🔒 需登录';
        var ab=document.getElementById('auth-btn');
        if(ab){
            if(isLogin){ab.innerText='👤 '+(data.nickname||data.email.split('@')[0]||'?');ab.title=data.email||'';}
            else{ab.innerText='🔑 登录/注册';ab.title='';}
        }
        var ws=document.getElementById('win-streak-display');if(ws){if(data.winStreak>=3){ws.innerHTML='🔥 '+data.winStreak+'连胜！';ws.style.display='';}else if(data.winStreak>0){ws.innerHTML='⭐ '+data.winStreak+'连胜';ws.style.display='';}else{ws.style.display='none';}}
        var ck=document.getElementById('checkin-btn');if(ck){var t=_today();if(data.dailyCheckinDate===t){ck.disabled=true;ck.innerText='✅ 已签到';}else{ck.disabled=false;ck.innerText='📅 签到';}}
        var dc=document.getElementById('daily-challenges-list');if(dc&&data.dailyChallenges){var h='';for(var i=0;i<data.dailyChallenges.challenges.length;i++){var ch=data.dailyChallenges.challenges[i];var pct=Math.min(100,Math.round(ch.progress/ch.target*100));h+='<div class="dch-item'+(ch.completed?' dch-done':'')+(ch.claimed?' dch-claimed':'')+'">'+'<span class="dch-desc">'+ch.desc+'</span><span class="dch-prog">'+ch.progress+'/'+ch.target+'</span>'+'<div class="dch-bar"><div class="dch-bar-fill" style="width:'+pct+'%"></div></div>'+(ch.completed&&!ch.claimed?'<button class="dch-claim-btn" onclick="ProgressionManager.claimDaily(\''+ch.id+'\')">领取 +XP</button>':ch.claimed?'<span class="dch-claimed-label">✅ 已领</span>':'')+'</div>';}dc.innerHTML=h;}
    }
    function _toast(title,msg,color){
        var c=document.getElementById('toast-container');if(!c)return;
        var el=document.createElement('div');el.className='prog-toast';el.style.borderLeftColor=color||'#4caf50';
        el.innerHTML='<div class="prog-toast-title">'+title+'</div><div class="prog-toast-msg">'+msg+'</div>';c.appendChild(el);
        setTimeout(function(){el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(function(){el.remove();},400);},3500);
    }

    // ══════════════════════════════════════
    return {
        // ── 生命周期 ──
        async init(){
            var tok=localStorage.getItem('supabase_auth_token');
            if(tok){
                SupabaseREST.token=tok;
                var user=await SupabaseREST.getUser();
                if(user){authUid=user.id;console.log('🔑 uid='+authUid);}
                else{console.log('⚠️ token 已过期，清除');SupabaseREST.token=null;localStorage.removeItem('supabase_auth_token');}
            }
            // 清除旧格式 ID
            var oldId=localStorage.getItem('digitalfog_player_id');
            if(oldId&&oldId.indexOf('u_')===0)localStorage.removeItem('digitalfog_player_id');
            await load();
            refreshUI();
            // 踢同账号旧连接
            if(tok&&typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:tok});
        },
        // ── 昵称 ──
        getNickname:function(){
            if(data.nickname)return data.nickname;
            return'游客';
        },
        isLoggedIn:function(){return !!(authUid&&SupabaseREST.token);},
        getAuthUid:function(){return authUid;},

        // ── 登录/注册回调 ──
        async onLogin(uid,email,nick,coinBonus){
            authUid=uid;data.email=email;
            // 🌟 昵称优先：传入 > data已有 > 云拉取 > 空
            if(nick)data.nickname=nick;
            else if(!data.nickname&&SupabaseREST.token){
                var row=await SupabaseREST.dbGet('player_progress',uid);
                if(row&&row.nickname)data.nickname=row.nickname;
                console.log('🔍 从云补拉昵称: '+(row?row.nickname:'null'));
            }
            if(coinBonus!==undefined)data.coins=coinBonus;
            cacheSave();
            if(SupabaseREST.token)await saveNow();
            refreshUI();
            console.log('✅ onLogin: nick='+(data.nickname||'(空)')+' coins='+data.coins);
        },
        onLogout:function(){
            authUid=null;SupabaseREST.token=null;
            data=emptyData();data._sess=emptyData()._sess;
            sessionStorage.removeItem('prog_cache');
            refreshUI();
        },

        // ── 对局事件 ──
        isRankedGame:false,
        hasGuest:false,
        onGameStart:function(N){data._sess=emptyData()._sess;data._sess._mapCells=N||100;},
        onKill:function(type){data.stats['kills'+type.charAt(0).toUpperCase()+type.slice(1)]++;data._sess[type]++;checkAch();checkDaily();doSave();},
        onDeath:function(){data.stats.deaths++;data._sess.steppedOn=true;checkAch();checkDaily();doSave();},
        onSeenByEnemy:function(){data._sess.seenByEnemy=true;},
        async onGameEnd(won){
            var self=ProgressionManager, isGuest=!(authUid&&SupabaseREST.token);
            // 🌟 收益倍率：房内有游客 → 所有人×0.3；全登录 → ×1.0
            var m=(self.hasGuest||isGuest)?0.3:1;
            data.gamesPlayed++;
            addXP(Math.round(20*m));
            {var t=_today();if(data.dailyGameCoinDate!==t){data.dailyGameCoins=0;data.dailyGameCoinDate=t;}if(data.dailyGameCoins<100){var gCoin=Math.round(10*m);if(gCoin>0){data.dailyGameCoins+=gCoin;addCoins(gCoin,'对局完成');}}}
            if(self.isRankedGame)rankedGame(won);
            if(won){data._sess.won=true;data.gamesWon++;data.winStreak++;if(data.winStreak>data.bestWinStreak)data.bestWinStreak=data.winStreak;var b=Math.round(80*m);if(data.winStreak>=3)b+=Math.round(25*m);if(data.winStreak>=5)b+=Math.round(50*m);if(data.winStreak>=10)b+=Math.round(100*m);addXP(b);{var t2=_today();if(data.dailyGameCoinDate!==t2){data.dailyGameCoins=0;data.dailyGameCoinDate=t2;}var wCoin=Math.round(15*m);if(wCoin>0){data.dailyGameCoins+=wCoin;addCoins(wCoin,'胜利奖励');}}_toast('🏆 胜利！','+'+(b+Math.round(20*m))+'XP'+(data.winStreak>=3?' 🔸'+data.winStreak+'连胜！':'')+(self.hasGuest?' ⚠️含游客':''),'#4caf50');}
            else{data.winStreak=0;if(data._sess.turns>=5)addXP(Math.round(10*m));}
            checkAch();checkDaily();
            await saveNow();
            refreshUI();
        },
        onMinePlaced:function(){data.stats.minesPlaced++;data._sess.minesPl++;data._sess.usedSkill=true;checkAch();checkDaily();doSave();},
        onMineDefused:function(){data.stats.minesDefused++;data._sess.minesDf++;data._sess.usedSkill=true;checkAch();checkDaily();doSave();},
        onBlinkUsed:function(){data.stats.blinksUsed++;data._sess.blinks++;data._sess.usedSkill=true;checkAch();checkDaily();doSave();},
        onTreeJumpUsed:function(){data.stats.treeJumpsUsed++;data._sess.treeJumps++;data._sess.usedSkill=true;checkAch();checkDaily();doSave();},
        onBlastUsed:function(){data.stats.blastsUsed++;data._sess.blasts++;data._sess.usedSkill=true;checkAch();checkDaily();doSave();},
        onStuckDeath:function(){data._sess.stuckDeath=true;},
        onSPEarned:function(n){data.stats.totalSPEarned+=n;data._sess.sp+=n;checkAch();checkDaily();doSave();},
        onCellExplored:function(){data.stats.totalCellsExplored++;data._sess.explored++;checkDaily();doSave();},
        onTurnEnd:function(){data._sess.turns++;data._sess.firstTurn=false;if(data._sess.turns>=35)checkAch();},
        onMudHit:function(){data.stats.mudHits++;doSave();},

        // ── 签到 ──
        doCheckin:function(){
            var t=_today();if(data.dailyCheckinDate===t)return false;
            if(data.dailyCheckinDate===_yesterday())data.checkinStreak++;else data.checkinStreak=1;
            data.dailyCheckinDate=t;var r=20+data.checkinStreak*2;if(r>30)r=30;
            addCoins(r,'签到第'+data.checkinStreak+'天');
            return true;
        },
        claimDaily:function(id){
            if(!data.dailyChallenges)return;
            for(var i=0;i<data.dailyChallenges.challenges.length;i++){var ch=data.dailyChallenges.challenges[i];if(ch.id===id&&ch.completed&&!ch.claimed){ch.claimed=true;addXP(50+Math.floor(Math.random()*30));doSave();refreshUI();return;}}
        },

        // ── 查询 ──
        getLevelInfo:getLevelInfo,
        getCoins:function(){return data.coins;},
        getEmail:function(){return data.email;},
        getCheckinStreak:function(){return data.checkinStreak;},
        getDailyGameCoins:function(){return data.dailyGameCoins;},
        getDailyGameCoinDate:function(){return data.dailyGameCoinDate;},
        getRankScore:function(){return data.rankScore;},
        getRankTier:function(){return data.rankTier;},
        getRankLabel:function(){return RANK_LABELS[data.rankTier]||'🟤 青铜';},
        getSeasonGames:function(){return data.seasonGames;},
        getSeasonWins:function(){return data.seasonWins;},
        getSeasonStart:function(){return data.seasonStart;},
        getStats:function(){var s=data.stats,tk=s.killsStomp+s.killsMine+s.killsBlast;return Object.assign({},s,{totalKills:tk,kd:s.deaths>0?(tk/s.deaths).toFixed(1):tk,gamesPlayed:data.gamesPlayed,gamesWon:data.gamesWon,winRate:data.gamesPlayed>0?Math.round(data.gamesWon/data.gamesPlayed*100):0,achUnlocked:Object.keys(data.achievements).length,achTotal:Object.keys(ACHIEVEMENTS).length,coins:data.coins,checkinStreak:data.checkinStreak});},
        getAchievements:function(){return ACHIEVEMENTS;},
        getUnlockedAch:function(){return data.achievements;},
        getDailyChallenges:function(){return data.dailyChallenges;},
        getWinStreak:function(){return data.winStreak;},
        getBestStreak:function(){return data.bestWinStreak;},
        getRESTClient:function(){return SupabaseREST;},
        refreshUI:refreshUI,
        get LEVELS(){return LEVELS;},
        addXP:addXP,
        addCoins:addCoins,
    };
})();
// 帮助面板需要
var LEVELS_ALL = ProgressionManager.LEVELS;

// ══════════════════════════════════════
//  AuthManager
// ══════════════════════════════════════
var AuthManager = {
    initDone:false,
    init:function(){
        if(this.initDone)return;this.initDone=true;
        // ProgressionManager.init 已处理 token 恢复，这里只补 UI
        var tok=localStorage.getItem('supabase_auth_token');
        if(!tok)return;
        SupabaseREST.token=tok;
        // 通知服务器
        if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:tok});
    },

    toggleAuthModal:function(){
        var m=document.getElementById('auth-modal');
        if(m.style.display==='flex'){m.style.display='none';return;}
        if(SupabaseREST.token){if(confirm('已登录\n\n退出登录？'))this.logout();return;}
        m.style.display='flex';this.switchTab('login');
    },
    switchAuthTab:function(tab){
        document.getElementById('auth-tab-login').classList.toggle('active',tab==='login');
        document.getElementById('auth-tab-register').classList.toggle('active',tab==='register');
        document.getElementById('auth-form-login').style.display=tab==='login'?'':'none';
        document.getElementById('auth-form-register').style.display=tab==='register'?'':'none';
    },

    login:async function(){
        var email=document.getElementById('auth-email-login').value.trim();
        var pw=document.getElementById('auth-password-login').value;
        var err=document.getElementById('auth-error-login');
        var btn=document.querySelector('#auth-form-login .auth-submit');
        if(!email||!pw){err.textContent='请填写邮箱和密码';err.style.display='';return;}
        err.style.display='none';btn.disabled=true;btn.textContent='登录中...';
        try{
            var r=await SupabaseREST.login(email,pw);
            if(!r.ok){err.textContent=r.error;err.style.display='';btn.disabled=false;btn.textContent='登 录';return;}
            localStorage.setItem('supabase_auth_token',SupabaseREST.token);
            var row=await SupabaseREST.dbGet('player_progress',r.user.id);
            if(row)await ProgressionManager.onLogin(r.user.id,email,row.nickname||'',row.coins||0);
            else await ProgressionManager.onLogin(r.user.id,email,'',0);
            document.getElementById('auth-modal').style.display='none';
            if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:SupabaseREST.token});
            _bigToast('✅ 登录成功','欢迎回来，'+email);
            btn.disabled=false;btn.textContent='登 录';
        }catch(e){err.textContent='网络错误';err.style.display='';btn.disabled=false;btn.textContent='登 录';}
    },

    register:async function(){
        var err=document.getElementById('auth-error-register');
        var btn=document.querySelector('#auth-form-register .auth-submit');
        err.style.display='none';btn.disabled=true;btn.textContent='注册中...';
        try{
            var nick=(document.getElementById('auth-nickname').value||'').trim();
            var email=document.getElementById('auth-email-register').value.trim();
            var pw=document.getElementById('auth-password-register').value;
            var pw2=document.getElementById('auth-password-confirm').value;
            if(!nick||nick.length<2||nick.length>12){err.textContent='昵称2-12字符，必填';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(!email||!pw){err.textContent='请填写邮箱和密码';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(pw.length<8){err.textContent='密码至少8个字符';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(pw!==pw2){err.textContent='两次密码不一致';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(email.indexOf('@')<0||email.indexOf('.')<0){err.textContent='请输入有效邮箱';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            // ① 查昵称
            if(await SupabaseREST.nickExists(nick)){err.textContent='昵称已被占用';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            // ② 注册
            var r=await SupabaseREST.signup(email,pw);
            if(!r.ok){err.textContent=r.error;err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            localStorage.setItem('supabase_auth_token',SupabaseREST.token);
            // ③ 占昵称
            await SupabaseREST.nickClaim(nick,r.user.id);
            // ④ 写完整数据
            var srow={id:r.user.id,xp:0,level:1,games_played:0,games_won:0,win_streak:0,best_win_streak:0,coins:50,daily_checkin_date:'',checkin_streak:0,daily_game_coins:0,daily_game_coin_date:'',email:email,nickname:nick,rank_score:100,rank_tier:'bronze',season_games:0,season_wins:0,season_start:'',stats:{killsStomp:0,killsMine:0,killsBlast:0,deaths:0,minesPlaced:0,minesDefused:0,blinksUsed:0,treeJumpsUsed:0,blastsUsed:0,totalSPEarned:0,totalCellsExplored:0,mudHits:0},achievements:{},daily_challenges:null,updated_at:new Date().toISOString()};
            await SupabaseREST.dbUpsert('player_progress',srow);
            // ⑤ 设置本地
            await ProgressionManager.onLogin(r.user.id,email,nick,50);
            document.getElementById('auth-modal').style.display='none';
            if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:SupabaseREST.token});
            _bigReg(nick,email);
            btn.disabled=false;btn.textContent='注 册';
        }catch(e){err.textContent='注册失败';err.style.display='';btn.disabled=false;btn.textContent='注 册';}
    },

    checkin:async function(){
        if(!SupabaseREST.token){alert('请先登录再签到');return;}
        if(!ProgressionManager.doCheckin())alert('今天已经签到过了！');
    },

    logout:function(){
        SupabaseREST.logout();localStorage.removeItem('supabase_auth_token');
        if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:''});
        ProgressionManager.onLogout();
    }
};

function _bigToast(title,msg){
    var t=document.getElementById('toast-container');if(!t)return;
    var el=document.createElement('div');el.className='prog-toast';el.style.borderLeftColor='#4caf50';
    el.innerHTML='<div class="prog-toast-title">'+title+'</div><div class="prog-toast-msg">'+msg+'</div>';t.appendChild(el);
    setTimeout(function(){el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(function(){el.remove();},400);},3500);
}
function _bigReg(nick,email){
    var big=document.createElement('div');
    big.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    big.innerHTML='<div style="background:#fff;border-radius:16px;padding:30px 40px;text-align:center;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.4)"><div style="font-size:48px;margin-bottom:10px">🎉</div><div style="font-size:22px;font-weight:900;color:#4caf50;margin-bottom:8px">注册成功！</div><div style="font-size:15px;color:#555;margin-bottom:4px">'+email+'</div><div style="font-size:16px;color:#ff9800;font-weight:bold;margin-bottom:16px">昵称：'+nick+' · 送 50 Coin</div><button onclick="this.parentElement.parentElement.remove()" style="padding:10px 30px;border:none;border-radius:8px;background:#4caf50;color:#fff;font-size:16px;font-weight:bold;cursor:pointer">开始游戏 🎮</button></div>';
    document.body.appendChild(big);
    setTimeout(function(){if(big.parentElement)big.remove();},5000);
}

// ══════════════════════════════════════
//  toggleStats
// ══════════════════════════════════════
function toggleStats(){
    var modal=document.getElementById('stats-modal');
    if(modal.style.display==='flex'){modal.style.display='none';return;}
    var stats=ProgressionManager.getStats(),achDefs=ProgressionManager.getAchievements(),unlocked=ProgressionManager.getUnlockedAch();
    var achHTML='';for(var key in achDefs){var u=!!unlocked[key];var hidden=achDefs[key].hidden&&!u;achHTML+='<div class="ach-item '+(u?'unlocked':'locked')+'"><span class="ach-icon">'+(hidden?'❓':achDefs[key].icon)+'</span><div><div class="ach-name">'+(hidden?'？？？':achDefs[key].name)+'</div><div class="ach-desc">'+(hidden?'达成条件后揭晓':achDefs[key].desc)+'</div></div></div>';}
    var rkLabel=ProgressionManager.getRankLabel(),rkScore=ProgressionManager.getRankScore(),sg=ProgressionManager.getSeasonGames(),sw=ProgressionManager.getSeasonWins(),srate=sg>0?Math.round(sw/sg*100):0;
    document.getElementById('stats-body').innerHTML='<div class="stats-section-title">🏆 当前赛季 ('+ProgressionManager.getSeasonStart()+')</div>'+
        '<div class="stats-grid"><div class="stat-card highlight"><div class="stat-val">'+rkLabel+'</div><div class="stat-label">段位 ('+rkScore+'分)</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+sg+'场</div><div class="stat-label">赛季对局</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+srate+'%</div><div class="stat-label">赛季胜率</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+sw+'胜</div><div class="stat-label">赛季胜场</div></div></div>'+
        '<div class="stats-section-title">👤 综合数据</div>'+
        '<div class="stats-grid"><div class="stat-card highlight"><div class="stat-val">Lv.'+ProgressionManager.getLevelInfo().level+'</div><div class="stat-label">等级</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.gamesPlayed+'</div><div class="stat-label">总对局</div></div>'+
        '<div class="stat-card highlight"><div class="stat-val">'+stats.winRate+'%</div><div class="stat-label">总胜率</div></div>'+
        '<div class="stat-card"><div class="stat-val">🪙 '+stats.coins+'</div><div class="stat-label">金币</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+ProgressionManager.getBestStreak()+'</div><div class="stat-label">最长连胜</div></div>'+
        '<div class="stat-card"><div class="stat-val">📅 '+stats.checkinStreak+'天</div><div class="stat-label">连续签到</div></div></div>'+
        '<div class="kill-breakdown"><div class="kill-type"><div class="kt-icon">🥷</div><div class="kt-count">'+stats.killsStomp+'</div><div class="kt-label">踩死</div></div>'+
        '<div class="kill-type"><div class="kt-icon">💥</div><div class="kt-count">'+stats.killsBlast+'</div><div class="kt-label">轰杀</div></div>'+
        '<div class="kill-type"><div class="kt-icon">💣</div><div class="kt-count">'+stats.killsMine+'</div><div class="kt-label">雷杀</div></div></div>'+
        '<div class="stats-section-title">📋 其他统计</div>'+
        '<div class="stats-grid"><div class="stat-card"><div class="stat-val">'+stats.deaths+'</div><div class="stat-label">阵亡次数</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.totalKills+'</div><div class="stat-label">总击杀</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.kd+'</div><div class="stat-label">K/D 比</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.minesPlaced+'</div><div class="stat-label">埋雷数</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.minesDefused+'</div><div class="stat-label">拆除数</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.totalSPEarned+'</div><div class="stat-label">累计SP</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.blinksUsed+'</div><div class="stat-label">闪使用</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.treeJumpsUsed+'</div><div class="stat-label">树闪使用</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.blastsUsed+'</div><div class="stat-label">轰使用</div></div>'+
        '<div class="stat-card"><div class="stat-val">'+stats.totalCellsExplored+'</div><div class="stat-label">格子探索</div></div></div>'+
        '<div class="stats-section-title">🏅 成就 ('+stats.achUnlocked+'/'+stats.achTotal+')</div><div class="ach-grid">'+achHTML+'</div>';
    modal.style.display='flex';
}

// ══════════════════════════════════════
//  Lottery
// ══════════════════════════════════════
var Lottery={
    COST:15,REEL_ITEMS:['🪙','💎','⭐','🔥','💣','⚡','🎯','👻','✨','❌'],spinning:false,
    open:function(){
        var m=document.getElementById('lottery-modal');if(!m)return;
        document.getElementById('lottery-result').textContent='';
        for(var i=1;i<=3;i++){var r=document.getElementById('reel-'+i);r.textContent='❓';r.classList.remove('spinning');}
        document.getElementById('btn-spin').disabled=false;m.style.display='flex';
    },
    close:function(){var m=document.getElementById('lottery-modal');if(m)m.style.display='none';this.spinning=false;},
    spin:function(){
        if(this.spinning)return;
        if(ProgressionManager.getCoins()<this.COST){alert('Coin 不足！需要 '+this.COST+' 枚');return;}
        ProgressionManager.addCoins(-this.COST,'抽奖消耗');
        this.spinning=true;var btn=document.getElementById('btn-spin');if(btn)btn.disabled=true;
        var result=document.getElementById('lottery-result');if(result)result.textContent='';
        var reels=[document.getElementById('reel-1'),document.getElementById('reel-2'),document.getElementById('reel-3')];
        var finalIcons=[],stops=[600,1000,1400],self=this;
        for(var i=0;i<3;i++){finalIcons.push(this.REEL_ITEMS[Math.floor(Math.random()*this.REEL_ITEMS.length)]);reels[i].classList.add('spinning');}
        for(var j=0;j<3;j++){(function(idx){setTimeout(function(){reels[idx].classList.remove('spinning');reels[idx].textContent=finalIcons[idx];if(idx===2)self._resolve(finalIcons);},stops[idx]);})(j);}
    },
    _resolve:function(icons){
        this.spinning=false;var btn=document.getElementById('btn-spin');if(btn)btn.disabled=false;var result=document.getElementById('lottery-result');
        var allSame=icons[0]===icons[1]&&icons[1]===icons[2],twoSame=icons[0]===icons[1]||icons[1]===icons[2]||icons[0]===icons[2];
        var rare=icons.some(function(i){return i==='💎'||i==='👻';});
        if(allSame&&icons[0]==='💎'){ProgressionManager.addCoins(100,'🎰 三连💎大奖！');ProgressionManager.addXP(200);if(result)result.innerHTML='<span style="color:#ffd700">💎 ×3 超级大奖！</span><br>+100 Coin +200XP';}
        else if(allSame&&icons[0]==='⭐'){ProgressionManager.addCoins(60,'🎰 三连⭐');ProgressionManager.addXP(80);if(result)result.innerHTML='<span style="color:#ffd700">三连⭐！</span><br>+60 Coin +80XP';}
        else if(allSame){ProgressionManager.addCoins(40,'🎰 三连相同！');ProgressionManager.addXP(40);if(result)result.innerHTML='<span style="color:#ffd700">三连'+icons[0]+'！</span><br>+40 Coin +40XP';}
        else if(twoSame&&rare){ProgressionManager.addCoins(30,'🎰 对子+稀有');ProgressionManager.addXP(20);if(result)result.innerHTML='<span style="color:#7c4dff">对子+稀有！</span><br>+30 Coin +20XP';}
        else if(twoSame){ProgressionManager.addCoins(10,'🎰 对子');if(result)result.innerHTML='<span style="color:#aaa">对子！</span><br>+10 Coin';}
        else if(rare){ProgressionManager.addCoins(15,'🎰 稀有图标');if(result)result.innerHTML='<span style="color:#7c4dff">稀有图标！</span><br>+15 Coin';}
        else if(icons.indexOf('❌')>=0){if(result)result.innerHTML='<span style="color:#f44336">运气不佳...</span><br>再接再厉';}
        else{ProgressionManager.addCoins(5,'🎰 安慰奖');if(result)result.innerHTML='<span style="color:#888">参与奖</span><br>返还 +5 Coin';}
    }
};
