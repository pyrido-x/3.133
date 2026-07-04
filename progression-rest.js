// ==========================================
// progression-rest.js — Supabase REST 直连（零 CDN 依赖）
// 直接 HTTP 调用 Supabase API，国内可用，无需外部 SDK
// ==========================================

// ── 辅助 ──
function _yesterday(){var d=new Date();d.setDate(d.getDate()-1);return d.toISOString().split('T')[0];}

// ══════════════════════════════════════
//  Supabase REST 客户端（纯 fetch，零依赖）
// ══════════════════════════════════════
const SupabaseREST = {
    url: 'https://aafzofowmxwelamizqdb.supabase.co',
    anonKey: 'sb_publishable_a37aZUSE9_nd7CWibu5E7A_1IXx4T3K',
    token: null, // 登录后设置的 Bearer token

    _headers(){
        var h = { 'apikey': this.anonKey, 'Content-Type': 'application/json' };
        if (this.token) h['Authorization'] = 'Bearer ' + this.token;
        return h;
    },

    // ── 昵称 ──
    async nicknameExists(name){
        try {
            var r = await fetch(this.url+'/rest/v1/nicknames?nickname=eq.'+encodeURIComponent(name), {headers:this._headers()});
            if (!r.ok) return false;
            var arr = await r.json();
            return arr && arr.length > 0;
        } catch(e){ return false; }
    },

    async nicknameClaim(name, playerId){
        try {
            var r = await fetch(this.url+'/rest/v1/nicknames', {
                method:'POST', headers:this._headers(),
                body:JSON.stringify({nickname:name, player_id:playerId})
            });
            return r.ok;
        } catch(e){ return false; }
    },

    // ── 数据库操作 ──
    async dbGet(table, id){
        try {
            var r = await fetch(this.url+'/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id), {headers:this._headers()});
            if (!r.ok) return null;
            var arr = await r.json();
            return arr && arr.length ? arr[0] : null;
        } catch(e){ return null; }
    },

    async dbUpsert(table, row){
        try {
            var r = await fetch(this.url+'/rest/v1/'+table, {
                method:'POST', headers:Object.assign({}, this._headers(), {'Prefer':'resolution=merge-duplicates'}),
                body:JSON.stringify(row)
            });
            return r.ok;
        } catch(e){ return false; }
    },

    async dbDelete(table, id){
        try {
            await fetch(this.url+'/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id), {method:'DELETE',headers:this._headers()});
        } catch(e){}
    },

    // ── 认证操作 ──
    async authSignup(email, password){
        var r=await fetch(this.url+'/auth/v1/signup',{method:'POST',headers:this._headers(),body:JSON.stringify({email:email,password:password})});
        var data=await r.json();
        console.log('Supabase signup response:', r.status, JSON.stringify(data).substring(0,200));
        if(r.ok&&data.access_token){this.token=data.access_token;return{ok:true,user:data.user};}
        return{ok:false,error:data.msg||data.message||'注册失败('+r.status+')'};
    },

    async authLogin(email, password){
        var r=await fetch(this.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:this._headers(),body:JSON.stringify({email:email,password:password})});
        var data=await r.json();
        console.log('Supabase login response:', r.status, JSON.stringify(data).substring(0,200));
        if(r.ok&&data.access_token){this.token=data.access_token;return{ok:true,user:data.user};}
        return{ok:false,error:data.error_description||data.msg||'登录失败('+r.status+')'};
    },

    async authGetUser(){
        if (!this.token) return null;
        try {
            var r = await fetch(this.url+'/auth/v1/user', {headers:this._headers()});
            if (!r.ok) return null;
            return await r.json();
        } catch(e){ return null; }
    },

    logout(){ this.token = null; },

    // 是否可用（配置完整）
    ready(){ return !!this.url && !!this.anonKey; }
};

// ══════════════════════════════════════
//  ProgressionManager（等级/货币/段位/成就/每日）
// ══════════════════════════════════════
const ProgressionManager = (function(){
    var PLAYER_ID_KEY='digitalfog_player_id';
    var _cachedAuthUid=null, data=null;
    var LEVELS=LEVELS_ALL=[
        {xp:0,title:'新兵'},{xp:100,title:'见习'},{xp:250,title:'列兵'},{xp:450,title:'上等兵'},
        {xp:700,title:'下士'},{xp:1000,title:'中士'},{xp:1400,title:'上士'},{xp:1900,title:'军士长'},
        {xp:2500,title:'少尉'},{xp:3200,title:'中尉'},{xp:4000,title:'上尉'},{xp:5000,title:'少校'},
        {xp:6200,title:'中校'},{xp:7600,title:'上校'},{xp:9200,title:'大校'},{xp:11000,title:'准将'},
        {xp:13000,title:'少将'},{xp:15500,title:'中将'},{xp:18500,title:'上将'},{xp:22000,title:'大将'},
        {xp:26000,title:'元帅'},{xp:31000,title:'战争领主'},{xp:37000,title:'传奇'},{xp:44000,title:'史诗'},
        {xp:52000,title:'神话'},{xp:62000,title:'不朽'},{xp:74000,title:'战神'},{xp:88000,title:'半神'},
        {xp:105000,title:'神谕'},{xp:125000,title:'创世'}
    ];
    var ACHIEVEMENTS={
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
        survivor:{name:'幸存者',desc:'单局存活超过20回合',icon:'🛡️'},
        tianhu:{name:'天胡',desc:'第一回合踩死敌人',icon:'🌅'},dihu:{name:'地胡',desc:'第一回合被敌人踩死',icon:'🌑'}
    };
    var DAILY_TEMPLATES=[
        {id:'kill_any_3',desc:'击杀3个敌人',target:3,cat:'kill'},{id:'kill_stomp_2',desc:'踩死2个敌人',target:2,cat:'stomp'},
        {id:'kill_blast_2',desc:'使用轰击杀2次',target:2,cat:'blast'},{id:'kill_mine_1',desc:'用地雷炸死1个敌人',target:1,cat:'mineKill'},
        {id:'win_1',desc:'赢得1场对局',target:1,cat:'win'},{id:'place_mines_5',desc:'埋设5颗地雷',target:5,cat:'mine'},
        {id:'defuse_3',desc:'拆除3颗地雷',target:3,cat:'defuse'},{id:'use_blink_5',desc:'使用闪5次',target:5,cat:'blink'},
        {id:'use_tree_jump_5',desc:'使用树闪5次',target:5,cat:'treejump'},{id:'use_blast_3',desc:'使用轰3次',target:3,cat:'blastUse'},
        {id:'explore_20',desc:'探索20个新格子',target:20,cat:'explore'},{id:'earn_sp_30',desc:'获得30点SP',target:30,cat:'sp'},
        {id:'survive_15',desc:'单局存活15回合',target:1,cat:'survive'},{id:'play_3',desc:'完成3场对局',target:3,cat:'play'}
    ];
    var RANK_LABELS={bronze:'🟤 青铜',silver:'⚪ 白银',gold:'🟡 黄金',platinum:'🟣 铂金',diamond:'💎 钻石',master:'👑 大师',grandmaster:'🌟 宗师'};
    // 段位门槛: 100→250→450→700→1000→1400→1900 (差150/200/250/300/400/500)
    var RANK_THRESHOLDS=[{tier:'bronze',min:0},{tier:'silver',min:250},{tier:'gold',min:450},{tier:'platinum',min:700},{tier:'diamond',min:1000},{tier:'master',min:1400},{tier:'grandmaster',min:1900}];

    function getPlayerId(){
        var p=localStorage.getItem(PLAYER_ID_KEY);
        if(!p){p='anon_'+crypto.randomUUID();localStorage.setItem(PLAYER_ID_KEY,p);}
        return p;
    }
    function getEffectiveId(){return _cachedAuthUid||getPlayerId();}

    function defaults(){return{
        xp:0,level:1,gamesPlayed:0,gamesWon:0,winStreak:0,bestWinStreak:0,
        coins:0,dailyCheckinDate:'',checkinStreak:0,dailyGameCoins:0,dailyGameCoinDate:'',email:'',nickname:'',
        rankScore:100,rankTier:'bronze',seasonGames:0,seasonWins:0,seasonStart:'',
        stats:{killsStomp:0,killsMine:0,killsBlast:0,deaths:0,minesPlaced:0,minesDefused:0,
               blinksUsed:0,treeJumpsUsed:0,blastsUsed:0,totalSPEarned:0,totalCellsExplored:0,mudHits:0},
        achievements:{},dailyChallenges:null,
        _sess:{stomp:0,mine:0,blast:0,explored:0,turns:0,steppedOn:false,seenByEnemy:false,sp:0,minesPl:0,minesDf:0,blinks:0,treeJumps:0,blasts:0,firstTurn:true}
    };}

    function saveToCloudNow(){saveToCloud();}

    async function loadFromCloud(){
        if(!SupabaseREST.ready()||!SupabaseREST.token)return null;
        var eid=getEffectiveId();
        var row=await SupabaseREST.dbGet('player_progress',eid);
        if(row)return row;
        return null;
    }

    function _saveCache(){
        try{
            var o={};
            o.xp=data.xp;o.level=data.level;o.games_played=data.gamesPlayed;o.games_won=data.gamesWon;
            o.win_streak=data.winStreak;o.best_win_streak=data.bestWinStreak;
            o.coins=data.coins;o.daily_checkin_date=data.dailyCheckinDate;o.checkin_streak=data.checkinStreak;
            o.daily_game_coins=data.dailyGameCoins;o.daily_game_coin_date=data.dailyGameCoinDate;
            o.email=data.email;o.nickname=data.nickname;
            o.rank_score=data.rankScore;o.rank_tier=data.rankTier;o.season_games=data.seasonGames;
            o.season_wins=data.seasonWins;o.season_start=data.seasonStart;
            o.stats=data.stats;o.achievements=data.achievements;o.daily_challenges=data.dailyChallenges;
            sessionStorage.setItem('prog_cache',JSON.stringify(o));
        }catch(e){}
    }
    function _loadCache(){
        try{var r=sessionStorage.getItem('prog_cache');if(r){var row=JSON.parse(r);loadFromRow(row);return true;}}catch(e){}
        return false;
    }

    async function saveToCloud(){
        _saveCache(); // 🌟 游客/登录都缓存到 session（刷新不丢）
        if(!SupabaseREST.ready()||!SupabaseREST.token)return; // 游客不写云
        _maybeStartSeason();
        var row={
            id:getEffectiveId(),xp:data.xp,level:data.level,games_played:data.gamesPlayed,games_won:data.gamesWon,
            win_streak:data.winStreak,best_win_streak:data.bestWinStreak,coins:data.coins,
            daily_checkin_date:data.dailyCheckinDate,checkin_streak:data.checkinStreak,
            daily_game_coins:data.dailyGameCoins,daily_game_coin_date:data.dailyGameCoinDate,email:data.email,nickname:data.nickname,
            rank_score:data.rankScore,rank_tier:data.rankTier,season_games:data.seasonGames,season_wins:data.seasonWins,season_start:data.seasonStart,
            stats:data.stats,achievements:data.achievements,daily_challenges:data.dailyChallenges,updated_at:new Date().toISOString()
        };
        await SupabaseREST.dbUpsert('player_progress',row);
        if(getEffectiveId()!==getPlayerId()){SupabaseREST.dbDelete('player_progress',getPlayerId());}
    }

    function loadFromRow(row){
        var def=defaults();
        if(row){
            data={xp:row.xp||0,level:row.level||1,gamesPlayed:row.games_played||0,gamesWon:row.games_won||0,
                winStreak:row.win_streak||0,bestWinStreak:row.best_win_streak||0,coins:row.coins||0,
                dailyCheckinDate:row.daily_checkin_date||'',checkinStreak:row.checkin_streak||0,dailyGameCoins:row.daily_game_coins||0,
                dailyGameCoinDate:row.daily_game_coin_date||'',email:row.email||'',nickname:row.nickname||'',
                rankScore:row.rank_score!=null?row.rank_score:100,rankTier:row.rank_tier||'bronze',seasonGames:row.season_games||0,
                seasonWins:row.season_wins||0,seasonStart:row.season_start||'',
                stats:{...def.stats,...(row.stats||{})},achievements:row.achievements||{},
                dailyChallenges:row.daily_challenges||null,_sess:def._sess};
        }else{data=def;}
        _checkDaily();_maybeStartSeason();
    }

    async function load(){
        var row=await loadFromCloud();
        if(row){console.log('☁️ 云端数据已加载');loadFromRow(row);return;}
        if(_loadCache()){console.log('💾 从缓存恢复');return;}
        data=defaults();data._sess=defaults()._sess;_checkDaily();console.log('📦 游客模式');
    }

    function _checkDaily(){
        var today=new Date().toISOString().split('T')[0];
        if(!data.dailyChallenges||data.dailyChallenges.date!==today){
            var pool=[].concat(DAILY_TEMPLATES),chosen=[];
            for(var i=0;i<3&&pool.length;i++){var idx=Math.floor(Math.random()*pool.length);chosen.push(Object.assign({},pool.splice(idx,1)[0],{progress:0,completed:false,claimed:false}));}
            data.dailyChallenges={date:today,challenges:chosen};saveToCloud();
        }
    }
    function _getSeasonKey(){var d=new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);}
    function _maybeStartSeason(){
        var key=_getSeasonKey();
        if(!data.seasonStart||data.seasonStart!==key){data.seasonStart=key;data.rankScore=100;data.rankTier='bronze';data.seasonGames=0;data.seasonWins=0;}
    }
    function _computeRankTier(s){for(var i=RANK_THRESHOLDS.length-1;i>=0;i--){if(s>=RANK_THRESHOLDS[i].min)return RANK_THRESHOLDS[i].tier;}return'bronze';}
    function _recalcRank(){data.rankTier=_computeRankTier(data.rankScore);}

    function getLevelInfo(){
        var lv=Math.min(data.level,LEVELS_ALL.length),cur=LEVELS_ALL[lv-1],nxt=lv<LEVELS_ALL.length?LEVELS_ALL[lv]:null;
        var into=data.xp-cur.xp,need=nxt?nxt.xp-cur.xp:0;
        return{level:lv,title:cur.title,xp:data.xp,xpIntoLevel:into,xpNeeded:need,progress:nxt?Math.min(100,Math.round(into/need*100)):100,nextTitle:nxt?nxt.title:'MAX'};
    }

    function _addXP(amount){
        var oldLv=data.level;data.xp+=amount;var nl=1;
        for(var i=LEVELS_ALL.length-1;i>=0;i--){if(data.xp>=LEVELS_ALL[i].xp){nl=i+1;break;}}
        data.level=Math.min(nl,LEVELS_ALL.length);saveToCloud();
        if(data.level>oldLv){for(var lv=oldLv+1;lv<=data.level;lv++)toast('🎉 等级提升！','Lv.'+lv+' '+LEVELS_ALL[lv-1].title,'#4caf50');}
        _refreshUI();
    }
    function _addCoins(amount,reason){data.coins+=amount;saveToCloud();if(amount>0)toast('🪙 +'+amount+' Coin',reason||'','#ff9800');_refreshUI();}

    function _refreshUI(){
        var info=getLevelInfo();
        var b=document.getElementById('player-level-badge');if(b)b.innerHTML='Lv.'+info.level+' <span style="font-size:10px;opacity:0.8">'+info.title+'</span>';
        var bar=document.getElementById('xp-bar-fill');if(bar){bar.style.width=info.progress+'%';bar.title=info.xpIntoLevel+'/'+info.xpNeeded+' XP';}
        var xpt=document.getElementById('xp-text');if(xpt)xpt.textContent=info.nextTitle!=='MAX'?info.xpIntoLevel+'/'+info.xpNeeded+' XP → '+info.nextTitle:'已达最高等级';
        var cd=document.getElementById('coin-display');if(cd)cd.innerHTML='🪙 '+data.coins;
        var isLogin=!!(_cachedAuthUid&&SupabaseREST.token);
        var rk=document.getElementById('rank-display');if(rk)rk.innerHTML=isLogin?((RANK_LABELS[data.rankTier]||'🟤 青铜')+' <span style="font-size:9px;opacity:0.7">'+data.rankScore+'分</span>'):'👤 游客';
        var rbm=document.getElementById('rank-badge-mini');if(rbm)rbm.textContent=isLogin?(RANK_LABELS[data.rankTier]||'🟤 青铜'):'🔑 登录';
        var nd=document.getElementById('nickname-display');if(nd&&data.nickname)nd.innerHTML='👤 '+data.nickname;
        var ws=document.getElementById('win-streak-display');if(ws){if(data.winStreak>=3){ws.innerHTML='🔥 '+data.winStreak+'连胜！';ws.style.display='';}else if(data.winStreak>0){ws.innerHTML='⭐ '+data.winStreak+'连胜';ws.style.display='';}else{ws.style.display='none';}}
        var ck=document.getElementById('checkin-btn');if(ck){var today=new Date().toISOString().split('T')[0];if(data.dailyCheckinDate===today){ck.disabled=true;ck.innerText='✅ 已签到';}else{ck.disabled=false;ck.innerText='📅 签到';}}
        var dc=document.getElementById('daily-challenges-list');if(dc&&data.dailyChallenges){var h='';for(var i=0;i<data.dailyChallenges.challenges.length;i++){var ch=data.dailyChallenges.challenges[i];var pct=Math.min(100,Math.round(ch.progress/ch.target*100));h+='<div class="dch-item'+(ch.completed?' dch-done':'')+(ch.claimed?' dch-claimed':'')+'">'+'<span class="dch-desc">'+ch.desc+'</span><span class="dch-prog">'+ch.progress+'/'+ch.target+'</span>'+'<div class="dch-bar"><div class="dch-bar-fill" style="width:'+pct+'%"></div></div>'+(ch.completed&&!ch.claimed?'<button class="dch-claim-btn" onclick="ProgressionManager.claimDaily(\''+ch.id+'\')">领取 +XP</button>':ch.claimed?'<span class="dch-claimed-label">✅ 已领</span>':'')+'</div>';}dc.innerHTML=h;}
    }

    function toast(title,msg,color){
        var c=document.getElementById('toast-container');if(!c)return;
        var el=document.createElement('div');el.className='prog-toast';el.style.borderLeftColor=color||'#4caf50';
        el.innerHTML='<div class="prog-toast-title">'+title+'</div><div class="prog-toast-msg">'+msg+'</div>';c.appendChild(el);
        setTimeout(function(){el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(function(){el.remove();},400);},3500);
    }

    function checkAchievements(){
        var s=data.stats;
        var checks={
            first_win:data.gamesWon>=1,win_10:data.gamesWon>=10,win_50:data.gamesWon>=50,
            stomp_10:s.killsStomp>=10,stomp_50:s.killsStomp>=50,blast_10:s.killsBlast>=10,blast_50:s.killsBlast>=50,
            mine_10:s.killsMine>=10,mine_50:s.killsMine>=50,tree_jump_50:s.treeJumpsUsed>=50,tree_jump_200:s.treeJumpsUsed>=200,
            blink_50:s.blinksUsed>=50,blink_200:s.blinksUsed>=200,mines_placed_30:s.minesPlaced>=30,mines_defused_20:s.minesDefused>=20,
            sp_500:s.totalSPEarned>=500,sp_2000:s.totalSPEarned>=2000,streak_3:data.bestWinStreak>=3,streak_5:data.bestWinStreak>=5,streak_10:data.bestWinStreak>=10,
            grand_slam:data._sess.stomp>0&&data._sess.mine>0&&data._sess.blast>0,ghost:!data._sess.seenByEnemy&&(data._sess.stomp>0||data._sess.mine>0||data._sess.blast>0),survivor:data._sess.turns>=20,tianhu:data._sess.firstTurn&&data._sess.stomp>0,dihu:data._sess.firstTurn&&data._sess.steppedOn
        };
        for(var key in checks){if(checks[key]&&!data.achievements[key]){data.achievements[key]={unlockedAt:Date.now()};var a=ACHIEVEMENTS[key];toast(a.icon+' 成就解锁！',a.name+' — '+a.desc,'#ff9800');_addXP(30);}}
        saveToCloud();
    }

    function checkDaily(){
        if(!data.dailyChallenges)return;var s=data._sess;
        for(var i=0;i<data.dailyChallenges.challenges.length;i++){var ch=data.dailyChallenges.challenges[i];if(ch.completed)continue;var p=0;switch(ch.id){case'kill_any_3':p=s.stomp+s.mine+s.blast;break;case'kill_stomp_2':p=s.stomp;break;case'kill_blast_2':p=s.blast;break;case'kill_mine_1':p=s.mine;break;case'win_1':p=data.gamesWon;break;case'place_mines_5':p=s.minesPl;break;case'defuse_3':p=s.minesDf;break;case'use_blink_5':p=s.blinks;break;case'use_tree_jump_5':p=s.treeJumps;break;case'use_blast_3':p=s.blasts;break;case'explore_20':p=s.explored;break;case'earn_sp_30':p=s.sp;break;case'survive_15':p=s.turns>=15?1:0;break;case'play_3':p=data.gamesPlayed;break;}ch.progress=Math.min(ch.target,p);if(ch.progress>=ch.target)ch.completed=true;}
        saveToCloud();
    }

    function _onRankedGame(won){
        _maybeStartSeason();
        data.seasonGames++;
        var isPlacement = data.seasonGames <= 5;
        if(won){
            data.seasonWins++;
            data.rankScore += isPlacement ? 40 : 25;
            if(isPlacement) toast('🏆 定级赛胜利！','+'+(isPlacement?40:25)+(isPlacement?' (定级赛)':''),'#4caf50');
        }else{
            data.rankScore = Math.max(0, data.rankScore - (isPlacement ? 5 : 15));
            if(isPlacement) toast('⏳ 定级赛失利','-'+(isPlacement?5:15)+' (定级赛，扣分较少)','#ff9800');
        }
        if(data.seasonGames===6) toast('📊 定级赛完成！',(RANK_LABELS[_computeRankTier(data.rankScore)]||'')+' 当前段位已确定','#ffd700');
        _recalcRank();
    }

    // ══════════════════════════════════════
    return {
        async init(){
            // 🌟 清除旧格式的 localStorage 残留
            var oldId=localStorage.getItem(PLAYER_ID_KEY);
            if(oldId&&oldId.indexOf('u_')===0){localStorage.removeItem(PLAYER_ID_KEY);console.log('🧹 已清除旧ID格式');}
            console.log('🔍 Supabase REST: ready='+SupabaseREST.ready());
            await load();
            this.refreshUI();
        },
        addXP:function(a){_addXP(a);},
        getCoins:function(){return data.coins;},
        getCheckinStreak:function(){return data.checkinStreak;},
        getDailyGameCoins:function(){return data.dailyGameCoins;},
        getDailyGameCoinDate:function(){return data.dailyGameCoinDate;},
        getEmail:function(){return data.email;},
        getNickname:function(){
            if(_cachedAuthUid&&data.nickname)return data.nickname;
            if(_cachedAuthUid&&!data.nickname)return'';
            return'游客'; // 未登录
        },
        isLoggedIn:function(){return !!(_cachedAuthUid&&SupabaseREST.token);},
        setNickname:async function(name){
            if(!name||name.length<2||name.length>12){return{ok:false,error:'昵称2-12个字符'};}
            if(!/^[\w一-鿿぀-ゟ゠-ヿ가-힯]+$/.test(name)){return{ok:false,error:'昵称只能包含中/英/日/韩/数字/下划线'};}
            if(SupabaseREST.ready()&&SupabaseREST.token){
                var exists=await SupabaseREST.nicknameExists(name);
                if(exists)return{ok:false,error:'昵称已被占用了'};
                var pid=getEffectiveId();
                var claimed=await SupabaseREST.nicknameClaim(name,pid);
                if(!claimed)return{ok:false,error:'昵称已被占用了'};
            }
            data.nickname=name;saveToCloud();this.refreshUI();return{ok:true};
        },
        isRankedGame:false,
        getRankScore:function(){return data.rankScore;},
        getRankTier:function(){return data.rankTier;},
        getRankLabel:function(){return RANK_LABELS[data.rankTier]||'🟤 青铜';},
        getSeasonGames:function(){return data.seasonGames;},
        getSeasonWins:function(){return data.seasonWins;},
        getSeasonStart:function(){return data.seasonStart;},
        addCoins:function(a,r){_addCoins(a,r);},
        doCheckin:function(){
            var today=new Date().toISOString().split('T')[0];if(data.dailyCheckinDate===today)return false;
            if(data.dailyCheckinDate===_yesterday())data.checkinStreak++;else data.checkinStreak=1;
            data.dailyCheckinDate=today;var reward=20+data.checkinStreak*2;if(reward>30)reward=30;
            _addCoins(reward,'签到第'+data.checkinStreak+'天');saveToCloud();this.refreshUI();return true;
        },
        awardGameCoins:function(){var today=new Date().toISOString().split('T')[0];if(data.dailyGameCoinDate!==today){data.dailyGameCoins=0;data.dailyGameCoinDate=today;}if(data.dailyGameCoins>=100)return;data.dailyGameCoins+=10;_addCoins(10,'对局完成 (+10)');},
        awardWinCoins:function(){var today=new Date().toISOString().split('T')[0];if(data.dailyGameCoinDate!==today){data.dailyGameCoins=0;data.dailyGameCoinDate=today;}data.dailyGameCoins+=15;_addCoins(15,'匹配获胜奖励 (+15)');},
        onGameStart:function(){data._sess=defaults()._sess;},
        onKill:function(type){data.stats['kills'+type.charAt(0).toUpperCase()+type.slice(1)]++;data._sess[type]++;checkAchievements();checkDaily();saveToCloud();},
        onDeath:function(){data.stats.deaths++;data._sess.steppedOn=true;checkAchievements();checkDaily();saveToCloud();},
        onSeenByEnemy:function(){data._sess.seenByEnemy=true;},
        onGameEnd:function(won){
            data.gamesPlayed++;this.addXP(20);this.awardGameCoins();
            if(this.isRankedGame)_onRankedGame(won);
            if(won){data.gamesWon++;data.winStreak++;if(data.winStreak>data.bestWinStreak)data.bestWinStreak=data.winStreak;var b=80;if(data.winStreak>=3)b+=25;if(data.winStreak>=5)b+=50;if(data.winStreak>=10)b+=100;this.addXP(b);this.awardWinCoins();toast('🏆 胜利！','+'+(b+20)+'XP'+(data.winStreak>=3?' 🔥'+data.winStreak+'连胜！':''),'#4caf50');}
            else{data.winStreak=0;if(data._sess.turns>=5)this.addXP(10);}
            checkAchievements();checkDaily();saveToCloudNow();this.refreshUI();
        },
        onMinePlaced:function(){data.stats.minesPlaced++;data._sess.minesPl++;checkAchievements();checkDaily();saveToCloud();},
        onMineDefused:function(){data.stats.minesDefused++;data._sess.minesDf++;checkAchievements();checkDaily();saveToCloud();},
        onBlinkUsed:function(){data.stats.blinksUsed++;data._sess.blinks++;checkAchievements();checkDaily();saveToCloud();},
        onTreeJumpUsed:function(){data.stats.treeJumpsUsed++;data._sess.treeJumps++;checkAchievements();checkDaily();saveToCloud();},
        onBlastUsed:function(){data.stats.blastsUsed++;data._sess.blasts++;checkAchievements();checkDaily();saveToCloud();},
        onSPEarned:function(n){data.stats.totalSPEarned+=n;data._sess.sp+=n;checkAchievements();checkDaily();saveToCloud();},
        onCellExplored:function(){data.stats.totalCellsExplored++;data._sess.explored++;checkDaily();saveToCloud();},
        onTurnEnd:function(){data._sess.turns++;data._sess.firstTurn=false;if(data._sess.turns>=30)checkAchievements();},
        onMudHit:function(){data.stats.mudHits++;saveToCloud();},
        claimDaily:function(id){if(!data.dailyChallenges)return;var ch=data.dailyChallenges.challenges.find(function(c){return c.id===id;});if(!ch||!ch.completed||ch.claimed)return;ch.claimed=true;this.addXP(50+Math.floor(Math.random()*30));saveToCloud();this.refreshUI();},
        getLevelInfo:getLevelInfo,
        getStats:function(){var s=data.stats,tk=s.killsStomp+s.killsMine+s.killsBlast;return Object.assign({},s,{totalKills:tk,kd:s.deaths>0?(tk/s.deaths).toFixed(1):tk,gamesPlayed:data.gamesPlayed,gamesWon:data.gamesWon,winRate:data.gamesPlayed>0?Math.round(data.gamesWon/data.gamesPlayed*100):0,achUnlocked:Object.keys(data.achievements).length,achTotal:Object.keys(ACHIEVEMENTS).length,coins:data.coins,checkinStreak:data.checkinStreak});},
        getAchievements:function(){return ACHIEVEMENTS;},
        getUnlockedAch:function(){return data.achievements;},
        getDailyChallenges:function(){return data.dailyChallenges;},
        getWinStreak:function(){return data.winStreak;},
        getBestStreak:function(){return data.bestWinStreak;},
        refreshUI:function(){_refreshUI();},
        getRESTClient:function(){return SupabaseREST;},
        setAuth:function(uid,email){_cachedAuthUid=uid;data.email=email;saveToCloudNow();this.refreshUI();},
        clearAuth:function(){_cachedAuthUid=null;data=defaults();this.refreshUI();}
    };
})();

// ══════════════════════════════════════
//  AuthManager — REST 认证（无 CDN 依赖）
// ══════════════════════════════════════
var AuthManager = {
    _initDone:false,
    init:function(){
        if(this._initDone)return;this._initDone=true;
        // 尝试恢复已登录 session
        var tok=localStorage.getItem('supabase_auth_token');
        if(tok){SupabaseREST.token=tok;SupabaseREST.authGetUser().then(function(u){if(u)AuthManager._onSignedIn(u);else{AuthManager._onSignedOut();}});}
    },
    toggleAuthModal:function(){
        var modal=document.getElementById('auth-modal');
        if(!SupabaseREST.ready()){console.log('🔑 REST 未配置');return;}
        if(SupabaseREST.token){
            if(confirm('已登录\n\n退出登录？')){this.logout();}return;
        }
        modal.style.display='flex';this.switchAuthTab('login');
    },
    switchAuthTab:function(tab){
        document.getElementById('auth-tab-login').classList.toggle('active',tab==='login');
        document.getElementById('auth-tab-register').classList.toggle('active',tab==='register');
        document.getElementById('auth-form-login').style.display=tab==='login'?'':'none';
        document.getElementById('auth-form-register').style.display=tab==='register'?'':'none';
    },
    login:async function(){
        var email=document.getElementById('auth-email-login').value.trim();
        var password=document.getElementById('auth-password-login').value;
        var err=document.getElementById('auth-error-login');
        var btn=document.querySelector('#auth-form-login .auth-submit');
        if(!email||!password){err.textContent='请填写邮箱和密码';err.style.display='';return;}
        err.style.display='none';
        btn.disabled=true; btn.textContent='登录中...';
        try{
            console.log('📧 登录中: '+email);
            var r=await SupabaseREST.authLogin(email,password);
            if(!r.ok){err.textContent=r.error;err.style.display='';btn.disabled=false;btn.textContent='登 录';return;}
            localStorage.setItem('supabase_auth_token',SupabaseREST.token);
            document.getElementById('auth-modal').style.display='none';
            this._onSignedIn(r.user);
            // 用 ProgressionManager 的 toast
            var t=document.getElementById('toast-container');
            if(t){var el=document.createElement('div');el.className='prog-toast';el.style.borderLeftColor='#4caf50';el.innerHTML='<div class="prog-toast-title">✅ 登录成功</div><div class="prog-toast-msg">欢迎回来，'+email+'</div>';t.appendChild(el);setTimeout(function(){el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(function(){el.remove();},400);},3500);}
            btn.disabled=false; btn.textContent='登 录';
        }catch(e){err.textContent='网络错误，请重试';err.style.display='';btn.disabled=false;btn.textContent='登 录';console.error(e);}
    },
    register:async function(){
        var err=document.getElementById('auth-error-register');
        var btn=document.querySelector('#auth-form-register .auth-submit');
        err.style.display='none';
        btn.disabled=true; btn.textContent='注册中...';
        try{
            var nnEl=document.getElementById('auth-nickname');
            var nickname=nnEl?nnEl.value.trim():'';
            var email=document.getElementById('auth-email-register').value.trim();
            var password=document.getElementById('auth-password-register').value;
            var confirm=document.getElementById('auth-password-confirm').value;
            if(!email||!password){err.textContent='请填写邮箱和密码';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(password.length<8){err.textContent='密码至少8个字符';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(password!==confirm){err.textContent='两次密码不一致';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(email.indexOf('@')<0||email.indexOf('.')<0){err.textContent='请输入有效的邮箱地址';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            if(nickname){
                if(nickname.length<2||nickname.length>12){err.textContent='昵称2-12个字符';err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
                var nr=await ProgressionManager.setNickname(nickname);
                if(!nr.ok){err.textContent='昵称: '+nr.error;err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            }
            console.log('📧 注册中: '+email+(nickname?' ('+nickname+')':''));
            var r=await SupabaseREST.authSignup(email,password);
            if(!r.ok){err.textContent=r.error;err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            document.getElementById('auth-modal').style.display='none';
            localStorage.setItem('supabase_auth_token',SupabaseREST.token);
            ProgressionManager.addCoins(50,'注册奖励');
            this._onSignedIn(r.user);
            var t=document.getElementById('toast-container');
            if(t){var el=document.createElement('div');el.className='prog-toast';el.style.borderLeftColor='#4caf50';el.innerHTML='<div class="prog-toast-title">✅ 注册成功</div><div class="prog-toast-msg">'+email+' · +50 Coin</div>';t.appendChild(el);setTimeout(function(){el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(function(){el.remove();},400);},3500);}
            btn.disabled=false; btn.textContent='注 册';
        }catch(e){err.textContent='网络错误，请重试';err.style.display='';btn.disabled=false;btn.textContent='注 册';console.error(e);}
    },
    checkin:async function(){
        if(!SupabaseREST.token){alert('请先登录再签到');return;}
        if(!ProgressionManager.doCheckin())alert('今天已经签到过了！');
    },
    logout:function(){
        SupabaseREST.logout();localStorage.removeItem('supabase_auth_token');this._onSignedOut();
    },
    _onSignedIn:function(user){
        var email=user.email;var btn=document.getElementById('auth-btn');if(btn){btn.innerText='👤 '+email.split('@')[0];btn.title=email;}
        ProgressionManager.setAuth(user.id,email);console.log('🔑 已登录：'+email);
    },
    _onSignedOut:function(){
        var btn=document.getElementById('auth-btn');if(btn){btn.innerText='🔑 登录/注册';btn.title='';}
        ProgressionManager.clearAuth();console.log('🔑 已退出登录');
    }
};

// ══════════════════════════════════════
//  toggleStats() — 统计面板
// ══════════════════════════════════════
function toggleStats(){
    var modal=document.getElementById('stats-modal');
    if(modal.style.display==='flex'){modal.style.display='none';return;}
    var stats=ProgressionManager.getStats(),achDefs=ProgressionManager.getAchievements(),unlocked=ProgressionManager.getUnlockedAch();
    var achHTML='';for(var key in achDefs){var u=!!unlocked[key];achHTML+='<div class="ach-item '+(u?'unlocked':'locked')+'"><span class="ach-icon">'+achDefs[key].icon+'</span><div><div class="ach-name">'+achDefs[key].name+'</div><div class="ach-desc">'+achDefs[key].desc+'</div></div></div>';}
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
//  🎰 Lottery — 抽奖机
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
