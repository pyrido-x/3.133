// ==========================================
// 🌟 玩家进度系统 + 账号认证 + 货币签到
// progression-manager.js — Supabase + localStorage 双写
// ==========================================

// ── 辅助函数 ──
function _yesterday() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

// ══════════════════════════════════════
//  ProgressionManager
// ══════════════════════════════════════
const ProgressionManager = (function() {
    const STORAGE_KEY = 'digitalfog_progression_v2';
    const PLAYER_ID_KEY = 'digitalfog_player_id';

    const SUPABASE_CONFIG = {
        url: 'https://aafzofowmxwelamizqdb.supabase.co',
        anonKey: 'sb_publishable_a37aZUSE9_nd7CWibu5E7A_1IXx4T3K',
    };

    const LEVELS = [
        { xp: 0, title: '新兵' },
        { xp: 100, title: '见习' },    { xp: 250, title: '列兵' },
        { xp: 450, title: '上等兵' },  { xp: 700, title: '下士' },
        { xp: 1000, title: '中士' },   { xp: 1400, title: '上士' },
        { xp: 1900, title: '军士长' }, { xp: 2500, title: '少尉' },
        { xp: 3200, title: '中尉' },   { xp: 4000, title: '上尉' },
        { xp: 5000, title: '少校' },   { xp: 6200, title: '中校' },
        { xp: 7600, title: '上校' },   { xp: 9200, title: '大校' },
        { xp: 11000, title: '准将' },  { xp: 13000, title: '少将' },
        { xp: 15500, title: '中将' },  { xp: 18500, title: '上将' },
        { xp: 22000, title: '大将' },  { xp: 26000, title: '元帅' },
        { xp: 31000, title: '战争领主' },{ xp: 37000, title: '传奇' },
        { xp: 44000, title: '史诗' },  { xp: 52000, title: '神话' },
        { xp: 62000, title: '不朽' },  { xp: 74000, title: '战神' },
        { xp: 88000, title: '半神' },  { xp: 105000, title: '神谕' },
        { xp: 125000, title: '创世' }
    ];

    const ACHIEVEMENTS = {
        first_win:     { name:'初尝胜果',   desc:'赢得第一场对局',         icon:'🏆' },
        win_10:        { name:'十胜将军',   desc:'累计赢得10场对局',       icon:'⚔️' },
        win_50:        { name:'五十胜王',   desc:'累计赢得50场对局',       icon:'👑' },
        stomp_10:      { name:'暗杀者',     desc:'踩死10个敌人',           icon:'🥷' },
        stomp_50:      { name:'近战大师',   desc:'踩死50个敌人',           icon:'🗡️' },
        blast_10:      { name:'远程炮手',   desc:'轰杀10个敌人',           icon:'💥' },
        blast_50:      { name:'毁灭者',     desc:'轰杀50个敌人',           icon:'🔥' },
        mine_10:       { name:'地雷专家',   desc:'用地雷炸死10个敌人',     icon:'💣' },
        mine_50:       { name:'雷神',       desc:'用地雷炸死50个敌人',     icon:'☠️' },
        tree_jump_50:  { name:'森林之子',   desc:'树闪使用50次',           icon:'🌳' },
        tree_jump_200: { name:'树灵',       desc:'树闪使用200次',          icon:'🌿' },
        blink_50:      { name:'闪现者',     desc:'闪使用50次',             icon:'⚡' },
        blink_200:     { name:'时空行者',   desc:'闪使用200次',            icon:'🌀' },
        mines_placed_30: { name:'布雷手',   desc:'埋设30颗地雷',           icon:'📌' },
        mines_defused_20:{ name:'拆弹专家', desc:'拆除20颗地雷',           icon:'🔧' },
        sp_500:        { name:'能源收集者', desc:'累计获得500SP',          icon:'🔋' },
        sp_2000:       { name:'能源大亨',   desc:'累计获得2000SP',         icon:'💰' },
        streak_3:      { name:'三连胜',     desc:'达成3连胜',              icon:'🔥' },
        streak_5:      { name:'五连胜',     desc:'达成5连胜',              icon:'💫' },
        streak_10:     { name:'十连胜',     desc:'达成10连胜',              icon:'🌟' },
        grand_slam:    { name:'大满贯',     desc:'一局内用三种方式击杀',   icon:'🎯' },
        ghost:         { name:'幽灵',       desc:'一局未被敌人踩到所在格', icon:'👻' },
        survivor:      { name:'幸存者',     desc:'单局存活超过20回合',     icon:'🛡️' },
    };

    const DAILY_TEMPLATES = [
        { id:'kill_any_3',       desc:'击杀3个敌人',          target:3,  cat:'kill' },
        { id:'kill_stomp_2',     desc:'踩死2个敌人',          target:2,  cat:'stomp' },
        { id:'kill_blast_2',     desc:'使用轰击杀2次',        target:2,  cat:'blast' },
        { id:'kill_mine_1',      desc:'用地雷炸死1个敌人',    target:1,  cat:'mineKill' },
        { id:'win_1',            desc:'赢得1场对局',          target:1,  cat:'win' },
        { id:'place_mines_5',    desc:'埋设5颗地雷',          target:5,  cat:'mine' },
        { id:'defuse_3',         desc:'拆除3颗地雷',          target:3,  cat:'defuse' },
        { id:'use_blink_5',      desc:'使用闪5次',            target:5,  cat:'blink' },
        { id:'use_tree_jump_5',  desc:'使用树闪5次',          target:5,  cat:'treejump' },
        { id:'use_blast_3',      desc:'使用轰3次',            target:3,  cat:'blastUse' },
        { id:'explore_20',       desc:'探索20个新格子',       target:20, cat:'explore' },
        { id:'earn_sp_30',       desc:'获得30点SP',           target:30, cat:'sp' },
        { id:'survive_15',       desc:'单局存活15回合',       target:1,  cat:'survive' },
        { id:'play_3',           desc:'完成3场对局',          target:3,  cat:'play' },
    ];

    let data = null, supabase = null;

    function initSupabase() {
        if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && window.supabase) {
            supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
            console.log('☁️ Supabase 已连接'); return true;
        }
        console.log('📦 离线模式'); return false;
    }

    function getPlayerId() {
        // 已登录 → 用 Supabase auth.uid()（跨设备同步）
        if (supabase && supabase.auth) {
            // 同步检查（大多数情况下 session 已加载）
            const { data: { session } } = supabase.auth._getSession ?
                supabase.auth._getSession() : { data: { session: null } };
            // 用更可靠的方式
        }
        let pid = localStorage.getItem(PLAYER_ID_KEY);
        if (!pid) { pid = 'u_' + crypto.randomUUID(); localStorage.setItem(PLAYER_ID_KEY, pid); }
        return pid;
    }

    // 🌟 获取当前有效的存储 ID（优先 auth.uid，兜底匿名 ID）
    function getEffectiveId() {
        let authUid = null;
        try {
            // supabase.auth.session() 同步获取缓存的 session
            const s = supabase && supabase.auth ? supabase.auth.session() : null;
            if (s && s.user) authUid = s.user.id;
        } catch(e) {}
        return authUid || getPlayerId();
    }

    function defaults() { return {
        xp:0, level:1, gamesPlayed:0, gamesWon:0, winStreak:0, bestWinStreak:0,
        coins:0, dailyCheckinDate:'', checkinStreak:0, dailyGameCoins:0, dailyGameCoinDate:'', email:'',
        // 🌟 段位分（快速匹配 = 段位赛，每月一赛季）
        rankScore:1000, rankTier:'bronze',
        seasonGames:0, seasonWins:0, seasonStart:'',
        stats:{ killsStomp:0,killsMine:0,killsBlast:0,deaths:0,minesPlaced:0,minesDefused:0,
                blinksUsed:0,treeJumpsUsed:0,blastsUsed:0,totalSPEarned:0,totalCellsExplored:0,mudHits:0 },
        achievements:{}, dailyChallenges:null,
        _sess:{ stomp:0,mine:0,blast:0,explored:0,turns:0,steppedOn:false,sp:0,minesPl:0,minesDf:0,blinks:0,treeJumps:0,blasts:0 }
    };}

    async function loadFromCloud() {
        if (!supabase) return null;
        const eid = getEffectiveId();
        try {
            const { data:row, error } = await supabase.from('player_progress').select('*').eq('id', eid).maybeSingle();
            if (error) { console.warn('Supabase 读取失败:', error.message); return null; }
            if (row) return row;
            // 🌟 登录用户：auth.uid 没数据但匿名ID有 → 尝试迁移
            if (eid !== getPlayerId()) {
                const { data:anonRow } = await supabase.from('player_progress').select('*').eq('id', getPlayerId()).maybeSingle();
                if (anonRow) return anonRow; // 返回匿名数据，saveToCloud 会用 eid 覆盖
            }
            return null;
        } catch(e) { console.warn('Supabase 连接失败:', e.message); return null; }
    }

    let _syncTimer = null;
    async function saveToCloud() {
        if (!supabase) return;
        _maybeStartSeason();
        const row = {
            id: getEffectiveId(), xp: data.xp, level: data.level,
            games_played: data.gamesPlayed, games_won: data.gamesWon,
            win_streak: data.winStreak, best_win_streak: data.bestWinStreak,
            coins: data.coins, daily_checkin_date: data.dailyCheckinDate,
            checkin_streak: data.checkinStreak, daily_game_coins: data.dailyGameCoins,
            daily_game_coin_date: data.dailyGameCoinDate, email: data.email,
            rank_score: data.rankScore, rank_tier: data.rankTier,
            season_games: data.seasonGames, season_wins: data.seasonWins,
            season_start: data.seasonStart,
            stats: data.stats, achievements: data.achievements,
            daily_challenges: data.dailyChallenges,
            updated_at: new Date().toISOString(),
        };
        try {
            const { error } = await supabase.from('player_progress').upsert(row);
            if (error) console.warn('Supabase 写入失败:', error.message);
            // 🌟 迁移：如果旧匿名数据还在，删掉它
            if (getEffectiveId() !== getPlayerId()) {
                supabase.from('player_progress').delete().eq('id', getPlayerId()).then(()=>{});
            }
        } catch(e) {}
    }
    function markCloudDirty() {
        if (!supabase) return; clearTimeout(_syncTimer); _syncTimer = setTimeout(saveToCloud, 2000);
    }
    function saveToCloudNow() { clearTimeout(_syncTimer); saveToCloud(); }

    function loadFromRow(row) {
        const def = defaults();
        if (row) {
            data = {
                xp:row.xp||0, level:row.level||1, gamesPlayed:row.games_played||0,
                gamesWon:row.games_won||0, winStreak:row.win_streak||0, bestWinStreak:row.best_win_streak||0,
                coins:row.coins||0, dailyCheckinDate:row.daily_checkin_date||'',
                checkinStreak:row.checkin_streak||0, dailyGameCoins:row.daily_game_coins||0,
                dailyGameCoinDate:row.daily_game_coin_date||'', email:row.email||'',
                rankScore:row.rank_score||1000, rankTier:row.rank_tier||'bronze',
                seasonGames:row.season_games||0, seasonWins:row.season_wins||0,
                seasonStart:row.season_start||'',
                stats:{...def.stats, ...(row.stats||{})}, achievements:row.achievements||{},
                dailyChallenges:row.daily_challenges||null, _sess:def._sess
            };
        } else { data = def; }
        _checkDaily();
        _maybeStartSeason();
    }

    function loadFromLocal() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) { data = JSON.parse(raw); const d=defaults(); for(const k of Object.keys(d)){if(!(k in data)&&k!=='_sess')data[k]=d[k];} }
            else { data = defaults(); }
        } catch(e) { data = defaults(); }
        data._sess = defaults()._sess;
        _checkDaily();
    }

    async function load() {
        const cloudRow = await loadFromCloud();
        if (cloudRow) { console.log('☁️ 从 Supabase 加载'); loadFromRow(cloudRow); }
        else loadFromLocal();
        saveLocal();
    }

    function saveLocal() {
        try { const o={}; for(const[k,v]of Object.entries(data)){if(k!=='_sess')o[k]=v;} localStorage.setItem(STORAGE_KEY,JSON.stringify(o)); } catch(e){}
    }
    function saveAll() { saveLocal(); markCloudDirty(); }

    function _checkDaily() {
        const today = new Date().toISOString().split('T')[0];
        if (!data.dailyChallenges || data.dailyChallenges.date !== today) {
            const pool=[...DAILY_TEMPLATES], chosen=[];
            for(let i=0;i<3&&pool.length;i++){const idx=Math.floor(Math.random()*pool.length);chosen.push({...pool.splice(idx,1)[0],progress:0,completed:false,claimed:false});}
            data.dailyChallenges={date:today,challenges:chosen}; saveAll();
        }
    }

    // ── 赛季管理（每月1日重置）──
    function _getSeasonKey() {
        const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    function _maybeStartSeason() {
        const key = _getSeasonKey();
        if (!data.seasonStart || data.seasonStart !== key) {
            data.seasonStart = key;
            data.rankScore = 1000;
            data.rankTier = 'bronze';
            data.seasonGames = 0;
            data.seasonWins = 0;
            console.log('🏆 新赛季开始：'+key);
        }
    }
    function _computeRankTier(score) {
        if (score >= 2000) return 'diamond';
        if (score >= 1700) return 'platinum';
        if (score >= 1400) return 'gold';
        if (score >= 1200) return 'silver';
        return 'bronze';
    }
    const RANK_LABELS = { bronze:'🟤 青铜', silver:'⚪ 白银', gold:'🟡 黄金', platinum:'🟣 铂金', diamond:'💎 钻石' };

    function _recalcRank() {
        data.rankTier = _computeRankTier(data.rankScore);
    }
    function _onRankedGame(won) {
        _maybeStartSeason();
        data.seasonGames++;
        if (won) {
            data.seasonWins++;
            data.rankScore += 25; // 胜利 +25
        } else {
            data.rankScore = Math.max(0, data.rankScore - 15); // 失败 -15，不低于0
        }
        _recalcRank();
    }

    function getLevelInfo() {
        const lv=Math.min(data.level,LEVELS.length), cur=LEVELS[lv-1], nxt=lv<LEVELS.length?LEVELS[lv]:null;
        const into=data.xp-cur.xp, need=nxt?nxt.xp-cur.xp:0;
        return {level:lv,title:cur.title,xp:data.xp,xpIntoLevel:into,xpNeeded:need,
                progress:nxt?Math.min(100,Math.round(into/need*100)):100,nextTitle:nxt?nxt.title:'MAX'};
    }

    function _addXP(amount) {
        const oldLv=data.level; data.xp+=amount;
        let nl=1;for(let i=LEVELS.length-1;i>=0;i--){if(data.xp>=LEVELS[i].xp){nl=i+1;break;}}
        data.level=Math.min(nl,LEVELS.length); saveAll();
        if(data.level>oldLv){for(let lv=oldLv+1;lv<=data.level;lv++)toast('🎉 等级提升！',`Lv.${lv} ${LEVELS[lv-1].title}`,'#4caf50');}
        _refreshUI();
    }

    function _addCoins(amount, reason) {
        data.coins+=amount; saveAll();
        if(amount>0)toast('🪙 +'+amount+' Coin',reason||'','#ff9800');
        _refreshUI();
    }

    function _refreshUI() {
        const info=getLevelInfo();
        const b=document.getElementById('player-level-badge'); if(b)b.innerHTML=`Lv.${info.level} <span style="font-size:10px;opacity:0.8">${info.title}</span>`;
        const bar=document.getElementById('xp-bar-fill'); if(bar){bar.style.width=info.progress+'%';bar.title=`${info.xpIntoLevel}/${info.xpNeeded} XP`;}
        const xpt=document.getElementById('xp-text'); if(xpt)xpt.textContent=info.nextTitle!=='MAX'?`${info.xpIntoLevel}/${info.xpNeeded} XP → ${info.nextTitle}`:'已达最高等级';
        const cd=document.getElementById('coin-display'); if(cd)cd.innerHTML=`🪙 ${data.coins}`;
        const rk=document.getElementById('rank-display'); if(rk)rk.innerHTML=`${RANK_LABELS[data.rankTier]||'🟤 青铜'} <span style="font-size:9px;opacity:0.7">${data.rankScore}分</span>`;
        const ws=document.getElementById('win-streak-display'); if(ws){if(data.winStreak>=3){ws.innerHTML=`🔥 ${data.winStreak}连胜！`;ws.style.display='';}else if(data.winStreak>0){ws.innerHTML=`⭐ ${data.winStreak}连胜`;ws.style.display='';}else{ws.style.display='none';}}
        const ck=document.getElementById('checkin-btn'); if(ck){const today=new Date().toISOString().split('T')[0];if(data.dailyCheckinDate===today){ck.disabled=true;ck.innerText='✅ 已签到';}else{ck.disabled=false;ck.innerText='📅 签到';}}
        const dc=document.getElementById('daily-challenges-list'); if(dc&&data.dailyChallenges){let h='';for(const ch of data.dailyChallenges.challenges){const pct=Math.min(100,Math.round(ch.progress/ch.target*100));h+=`<div class="dch-item${ch.completed?' dch-done':''}${ch.claimed?' dch-claimed':''}">`+`<span class="dch-desc">${ch.desc}</span><span class="dch-prog">${ch.progress}/${ch.target}</span>`+`<div class="dch-bar"><div class="dch-bar-fill" style="width:${pct}%"></div></div>`+(ch.completed&&!ch.claimed?`<button class="dch-claim-btn" onclick="ProgressionManager.claimDaily('${ch.id}')">领取 +XP</button>`:ch.claimed?'<span class="dch-claimed-label">✅ 已领</span>':'')+'</div>';}dc.innerHTML=h;}
    }

    function toast(title, msg, color) {
        const c=document.getElementById('toast-container'); if(!c)return;
        const el=document.createElement('div'); el.className='prog-toast'; el.style.borderLeftColor=color||'#4caf50';
        el.innerHTML=`<div class="prog-toast-title">${title}</div><div class="prog-toast-msg">${msg}</div>`; c.appendChild(el);
        setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(()=>el.remove(),400);},3500);
    }

    function checkAchievements() {
        const s=data.stats;
        const checks={
            first_win:data.gamesWon>=1,win_10:data.gamesWon>=10,win_50:data.gamesWon>=50,
            stomp_10:s.killsStomp>=10,stomp_50:s.killsStomp>=50,blast_10:s.killsBlast>=10,blast_50:s.killsBlast>=50,
            mine_10:s.killsMine>=10,mine_50:s.killsMine>=50,tree_jump_50:s.treeJumpsUsed>=50,tree_jump_200:s.treeJumpsUsed>=200,
            blink_50:s.blinksUsed>=50,blink_200:s.blinksUsed>=200,mines_placed_30:s.minesPlaced>=30,mines_defused_20:s.minesDefused>=20,
            sp_500:s.totalSPEarned>=500,sp_2000:s.totalSPEarned>=2000,streak_3:data.bestWinStreak>=3,streak_5:data.bestWinStreak>=5,streak_10:data.bestWinStreak>=10,
            grand_slam:data._sess.stomp>0&&data._sess.mine>0&&data._sess.blast>0,ghost:!data._sess.steppedOn&&data._sess.turns>=10,survivor:data._sess.turns>=20,
        };
        for(const[key,ok]of Object.entries(checks)){if(ok&&!data.achievements[key]){data.achievements[key]={unlockedAt:Date.now()};const a=ACHIEVEMENTS[key];toast(`${a.icon} 成就解锁！`,`${a.name} — ${a.desc}`,'#ff9800');_addXP(30);}}
        saveAll();
    }

    function checkDaily() {
        if(!data.dailyChallenges)return; const s=data._sess;
        for(const ch of data.dailyChallenges.challenges){if(ch.completed)continue;let p=0;switch(ch.id){case'kill_any_3':p=s.stomp+s.mine+s.blast;break;case'kill_stomp_2':p=s.stomp;break;case'kill_blast_2':p=s.blast;break;case'kill_mine_1':p=s.mine;break;case'win_1':p=data.gamesWon;break;case'place_mines_5':p=s.minesPl;break;case'defuse_3':p=s.minesDf;break;case'use_blink_5':p=s.blinks;break;case'use_tree_jump_5':p=s.treeJumps;break;case'use_blast_3':p=s.blasts;break;case'explore_20':p=s.explored;break;case'earn_sp_30':p=s.sp;break;case'survive_15':p=s.turns>=15?1:0;break;case'play_3':p=data.gamesPlayed;break;}ch.progress=Math.min(ch.target,p);if(ch.progress>=ch.target)ch.completed=true;}
        saveAll();
    }

    return {
        async init() { initSupabase(); await load(); if(supabase)saveToCloudNow(); this.refreshUI(); },
        addXP(a){_addXP(a);},
        getCoins(){return data.coins;},
        getCheckinStreak(){return data.checkinStreak;},
        getDailyGameCoins(){return data.dailyGameCoins;},
        getDailyGameCoinDate(){return data.dailyGameCoinDate;},
        getEmail(){return data.email;},
        getRankScore(){return data.rankScore;},
        getRankTier(){return data.rankTier;},
        getRankLabel(){return RANK_LABELS[data.rankTier]||'🟤 青铜';},
        getSeasonGames(){return data.seasonGames;},
        getSeasonWins(){return data.seasonWins;},
        getSeasonStart(){return data.seasonStart;},
        addCoins(a,r){_addCoins(a,r);},
        doCheckin(){
            const today=new Date().toISOString().split('T')[0];
            if(data.dailyCheckinDate===today)return false;
            if(data.dailyCheckinDate===_yesterday())data.checkinStreak++;else data.checkinStreak=1;
            data.dailyCheckinDate=today; let reward=20+data.checkinStreak*2; if(reward>30)reward=30;
            _addCoins(reward,`签到第${data.checkinStreak}天`); saveAll(); this.refreshUI(); return true;
        },
        awardGameCoins(){
            const today=new Date().toISOString().split('T')[0];
            if(data.dailyGameCoinDate!==today){data.dailyGameCoins=0;data.dailyGameCoinDate=today;}
            if(data.dailyGameCoins>=100)return; data.dailyGameCoins+=10; _addCoins(10,'对局完成 (+10)');
        },
        awardWinCoins(){
            const today=new Date().toISOString().split('T')[0];
            if(data.dailyGameCoinDate!==today){data.dailyGameCoins=0;data.dailyGameCoinDate=today;}
            data.dailyGameCoins+=15; _addCoins(15,'匹配获胜奖励 (+15)');
        },
        onGameStart(){data._sess=defaults()._sess;},
        onKill(type){
            data.stats['kills'+type.charAt(0).toUpperCase()+type.slice(1)]++; data._sess[type]++;
            checkAchievements(); checkDaily(); saveAll();
        },
        onDeath(){data.stats.deaths++;data._sess.steppedOn=true;saveAll();},
        onGameEnd(won){
            data.gamesPlayed++; this.addXP(20); this.awardGameCoins();
            _onRankedGame(won); // 🌟 段位分更新
            if(won){data.gamesWon++;data.winStreak++;if(data.winStreak>data.bestWinStreak)data.bestWinStreak=data.winStreak;let b=80;if(data.winStreak>=3)b+=25;if(data.winStreak>=5)b+=50;if(data.winStreak>=10)b+=100;this.addXP(b);this.awardWinCoins();toast('🏆 胜利！',`+${b+20}XP${data.winStreak>=3?' 🔥'+data.winStreak+'连胜！':''}`,'#4caf50');}
            else{data.winStreak=0;if(data._sess.turns>=5)this.addXP(10);}
            checkAchievements(); checkDaily(); saveToCloudNow(); this.refreshUI();
        },
        onMinePlaced(){data.stats.minesPlaced++;data._sess.minesPl++;checkAchievements();checkDaily();saveAll();},
        onMineDefused(){data.stats.minesDefused++;data._sess.minesDf++;checkAchievements();checkDaily();saveAll();},
        onBlinkUsed(){data.stats.blinksUsed++;data._sess.blinks++;checkAchievements();checkDaily();saveAll();},
        onTreeJumpUsed(){data.stats.treeJumpsUsed++;data._sess.treeJumps++;checkAchievements();checkDaily();saveAll();},
        onBlastUsed(){data.stats.blastsUsed++;data._sess.blasts++;checkAchievements();checkDaily();saveAll();},
        onSPEarned(n){data.stats.totalSPEarned+=n;data._sess.sp+=n;checkAchievements();checkDaily();saveAll();},
        onCellExplored(){data.stats.totalCellsExplored++;data._sess.explored++;checkDaily();saveAll();},
        onTurnEnd(){data._sess.turns++;if(data._sess.turns>=20)checkAchievements();},
        onMudHit(){data.stats.mudHits++;saveAll();},
        claimDaily(id){
            if(!data.dailyChallenges)return; const ch=data.dailyChallenges.challenges.find(c=>c.id===id);
            if(!ch||!ch.completed||ch.claimed)return; ch.claimed=true; this.addXP(50+Math.floor(Math.random()*30)); saveAll(); this.refreshUI();
        },
        getLevelInfo,
        getStats(){
            const s=data.stats, tk=s.killsStomp+s.killsMine+s.killsBlast;
            return {...s,totalKills:tk,kd:s.deaths>0?(tk/s.deaths).toFixed(1):tk,
                gamesPlayed:data.gamesPlayed,gamesWon:data.gamesWon,
                winRate:data.gamesPlayed>0?Math.round(data.gamesWon/data.gamesPlayed*100):0,
                achUnlocked:Object.keys(data.achievements).length,achTotal:Object.keys(ACHIEVEMENTS).length,
                coins:data.coins,checkinStreak:data.checkinStreak};
        },
        getAchievements(){return ACHIEVEMENTS;},
        getUnlockedAch(){return data.achievements;},
        getDailyChallenges(){return data.dailyChallenges;},
        getWinStreak(){return data.winStreak;},
        getBestStreak(){return data.bestWinStreak;},
        refreshUI(){_refreshUI();},
        getSupabaseClient(){return supabase;},
        async onAuthLogin(email){data.email=email;saveToCloudNow();this.refreshUI();},
    };
})();

// ══════════════════════════════════════
//  AuthManager — 账号系统
// ══════════════════════════════════════
const AuthManager = {
    _initDone: false,
    init(){
        if(this._initDone)return; this._initDone=true;
        const sup=ProgressionManager.getSupabaseClient(); if(!sup)return;
        sup.auth.onAuthStateChange((event,session)=>{
            if(event==='SIGNED_IN'&&session)this._onSignedIn(session.user.email);
            else if(event==='SIGNED_OUT')this._onSignedOut();
        });
        sup.auth.getSession().then(({data:{session}})=>{if(session)this._onSignedIn(session.user.email);});
    },
    toggleAuthModal(){
        const modal=document.getElementById('auth-modal'), sup=ProgressionManager.getSupabaseClient();
        if(!sup){alert('Supabase 未连接');return;}
        sup.auth.getSession().then(({data:{session}})=>{
            if(session){if(confirm(`已登录：${session.user.email}\n\n退出登录？`))sup.auth.signOut();return;}
            modal.style.display='flex'; this.switchAuthTab('login');
        });
    },
    switchAuthTab(tab){
        document.getElementById('auth-tab-login').classList.toggle('active',tab==='login');
        document.getElementById('auth-tab-register').classList.toggle('active',tab==='register');
        document.getElementById('auth-form-login').style.display=tab==='login'?'':'none';
        document.getElementById('auth-form-register').style.display=tab==='register'?'':'none';
    },
    async login(){
        const sup=ProgressionManager.getSupabaseClient(); if(!sup)return;
        const email=document.getElementById('auth-email-login').value.trim();
        const password=document.getElementById('auth-password-login').value;
        const err=document.getElementById('auth-error-login');
        if(!email||!password){err.textContent='请填写邮箱和密码';err.style.display='';return;}
        err.style.display='none';
        const {error}=await sup.auth.signInWithPassword({email,password});
        if(error){err.textContent=error.message;err.style.display='';}
        else document.getElementById('auth-modal').style.display='none';
    },
    async register(){
        const sup=ProgressionManager.getSupabaseClient(); if(!sup)return;
        const email=document.getElementById('auth-email-register').value.trim();
        const password=document.getElementById('auth-password-register').value;
        const confirm=document.getElementById('auth-password-confirm').value;
        const err=document.getElementById('auth-error-register');
        if(!email||!password){err.textContent='请填写邮箱和密码';err.style.display='';return;}
        if(password.length<8){err.textContent='密码至少8个字符';err.style.display='';return;}
        if(password!==confirm){err.textContent='两次密码不一致';err.style.display='';return;}
        if(!email.includes('@')||!email.includes('.')){err.textContent='请输入有效的邮箱地址';err.style.display='';return;}
        err.style.display='none';
        const {error}=await sup.auth.signUp({email,password});
        if(error){err.textContent=error.message;err.style.display='';}
        else{document.getElementById('auth-modal').style.display='none';ProgressionManager.addCoins(50,'注册奖励');}
    },
    async checkin(){
        const sup=ProgressionManager.getSupabaseClient();
        if(!sup){alert('签到需要连接 Supabase');return;}
        const {data:{session}}=await sup.auth.getSession();
        if(!session){alert('请先登录再签到');return;}
        if(!ProgressionManager.doCheckin())alert('今天已经签到过了！');
    },
    _onSignedIn(email){
        const btn=document.getElementById('auth-btn'); if(btn){btn.innerText=`👤 ${email.split('@')[0]}`;btn.title=email;}
        ProgressionManager.onAuthLogin(email); console.log(`🔑 已登录：${email}`);
    },
    _onSignedOut(){
        const btn=document.getElementById('auth-btn'); if(btn){btn.innerText='🔑 登录/注册';btn.title='';}
        console.log('🔑 已退出登录');
    },
};

// ══════════════════════════════════════
//  toggleStats() — 统计面板
// ══════════════════════════════════════
function toggleStats() {
    const modal=document.getElementById('stats-modal');
    if(modal.style.display==='flex'){modal.style.display='none';return;}
    const stats=ProgressionManager.getStats();
    const achDefs=ProgressionManager.getAchievements();
    const unlocked=ProgressionManager.getUnlockedAch();
    let achHTML='';
    for(const[key,a]of Object.entries(achDefs)){
        const u=!!unlocked[key];
        achHTML+=`<div class="ach-item ${u?'unlocked':'locked'}"><span class="ach-icon">${a.icon}</span><div><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div></div>`;
    }
    const rankLabel=ProgressionManager.getRankLabel();
    const rankScore=ProgressionManager.getRankScore();
    const seasGames=ProgressionManager.getSeasonGames();
    const seasWins=ProgressionManager.getSeasonWins();
    const seasWinRate=seasGames>0?Math.round(seasWins/seasGames*100):0;
    document.getElementById('stats-body').innerHTML=`
        <div class="stats-section-title">🏆 当前赛季 (${ProgressionManager.getSeasonStart()})</div>
        <div class="stats-grid">
            <div class="stat-card highlight"><div class="stat-val">${rankLabel}</div><div class="stat-label">段位 (${rankScore}分)</div></div>
            <div class="stat-card"><div class="stat-val">${seasGames}场</div><div class="stat-label">赛季对局</div></div>
            <div class="stat-card"><div class="stat-val">${seasWinRate}%</div><div class="stat-label">赛季胜率</div></div>
            <div class="stat-card"><div class="stat-val">${seasWins}胜</div><div class="stat-label">赛季胜场</div></div>
        </div>
        <div class="stats-section-title">👤 综合数据</div>
        <div class="stats-grid">
            <div class="stat-card highlight"><div class="stat-val">Lv.${ProgressionManager.getLevelInfo().level}</div><div class="stat-label">等级</div></div>
            <div class="stat-card"><div class="stat-val">${stats.gamesPlayed}</div><div class="stat-label">总对局</div></div>
            <div class="stat-card highlight"><div class="stat-val">${stats.winRate}%</div><div class="stat-label">总胜率</div></div>
            <div class="stat-card"><div class="stat-val">🪙 ${stats.coins}</div><div class="stat-label">金币</div></div>
            <div class="stat-card"><div class="stat-val">${ProgressionManager.getBestStreak()}</div><div class="stat-label">最长连胜</div></div>
            <div class="stat-card"><div class="stat-val">📅 ${stats.checkinStreak}天</div><div class="stat-label">连续签到</div></div>
        </div>
        <div class="kill-breakdown">
            <div class="kill-type"><div class="kt-icon">🥷</div><div class="kt-count">${stats.killsStomp}</div><div class="kt-label">踩死</div></div>
            <div class="kill-type"><div class="kt-icon">💥</div><div class="kt-count">${stats.killsBlast}</div><div class="kt-label">轰杀</div></div>
            <div class="kill-type"><div class="kt-icon">💣</div><div class="kt-count">${stats.killsMine}</div><div class="kt-label">雷杀</div></div>
        </div>
        <div class="stats-section-title">📋 其他统计</div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-val">${stats.deaths}</div><div class="stat-label">阵亡次数</div></div>
            <div class="stat-card"><div class="stat-val">${stats.totalKills}</div><div class="stat-label">总击杀</div></div>
            <div class="stat-card"><div class="stat-val">${stats.kd}</div><div class="stat-label">K/D 比</div></div>
            <div class="stat-card"><div class="stat-val">${stats.minesPlaced}</div><div class="stat-label">埋雷数</div></div>
            <div class="stat-card"><div class="stat-val">${stats.minesDefused}</div><div class="stat-label">拆除数</div></div>
            <div class="stat-card"><div class="stat-val">${stats.totalSPEarned}</div><div class="stat-label">累计SP</div></div>
            <div class="stat-card"><div class="stat-val">${stats.blinksUsed}</div><div class="stat-label">闪使用</div></div>
            <div class="stat-card"><div class="stat-val">${stats.treeJumpsUsed}</div><div class="stat-label">树闪使用</div></div>
            <div class="stat-card"><div class="stat-val">${stats.blastsUsed}</div><div class="stat-label">轰使用</div></div>
            <div class="stat-card"><div class="stat-val">${stats.totalCellsExplored}</div><div class="stat-label">格子探索</div></div>
        </div>
        <div class="stats-section-title">🏅 成就 (${stats.achUnlocked}/${stats.achTotal})</div>
        <div class="ach-grid">${achHTML}</div>
    `;
    modal.style.display='flex';
}

// ══════════════════════════════════════
//  🎰 Lottery — 抽奖机
// ══════════════════════════════════════
const Lottery = {
    COST: 15,
    REEL_ITEMS: ['🪙','💎','⭐','🔥','💣','⚡','🎯','👻','✨','❌'],
    spinning: false,

    open(){
        const modal=document.getElementById('lottery-modal');
        if(!modal)return;
        document.getElementById('lottery-result').textContent='';
        document.getElementById('reel-1').textContent='❓'; document.getElementById('reel-1').classList.remove('spinning');
        document.getElementById('reel-2').textContent='❓'; document.getElementById('reel-2').classList.remove('spinning');
        document.getElementById('reel-3').textContent='❓'; document.getElementById('reel-3').classList.remove('spinning');
        document.getElementById('btn-spin').disabled=false;
        modal.style.display='flex';
    },

    close(){
        const modal=document.getElementById('lottery-modal');
        if(modal)modal.style.display='none';
        this.spinning=false;
    },

    spin(){
        if(this.spinning)return;
        const coins=ProgressionManager.getCoins();
        if(coins<this.COST){alert(`Coin 不足！需要 ${this.COST} 枚，当前 ${coins} 枚`);return;}
        ProgressionManager.addCoins(-this.COST,'抽奖消耗');

        this.spinning=true;
        const btn=document.getElementById('btn-spin');
        if(btn)btn.disabled=true;
        const result=document.getElementById('lottery-result');
        if(result)result.textContent='';

        // 滚动动画
        const reels=[document.getElementById('reel-1'),document.getElementById('reel-2'),document.getElementById('reel-3')];
        const finalIcons=[];
        for(let i=0;i<3;i++){
            finalIcons.push(this.REEL_ITEMS[Math.floor(Math.random()*this.REEL_ITEMS.length)]);
            reels[i].classList.add('spinning');
        }

        // 逐个停转
        const stops=[600,1000,1400];
        for(let i=0;i<3;i++){
            setTimeout(()=>{
                reels[i].classList.remove('spinning');
                reels[i].textContent=finalIcons[i];
                reels[i].style.animation='none';
                void reels[i].offsetWidth;
                if(i===2){this._resolve(finalIcons);}
            },stops[i]);
        }
    },

    _resolve(icons){
        this.spinning=false;
        const btn=document.getElementById('btn-spin');
        if(btn)btn.disabled=false;
        const result=document.getElementById('lottery-result');

        // 判定
        const allSame=icons[0]===icons[1]&&icons[1]===icons[2];
        const twoSame=(icons[0]===icons[1])||(icons[1]===icons[2])||(icons[0]===icons[2]);
        const containsRare=icons.some(i=>['💎','👻'].includes(i));

        if(allSame&&icons[0]==='💎'){
            const bonus=100; ProgressionManager.addCoins(bonus,'🎰 三连💎大奖！'); ProgressionManager.addXP(200);
            if(result)result.innerHTML=`<span style="color:#ffd700">💎 ×3 超级大奖！</span><br>+${bonus} Coin +200XP`;
        }else if(allSame&&icons[0]==='⭐'){
            const bonus=60; ProgressionManager.addCoins(bonus,'🎰 三连⭐'); ProgressionManager.addXP(80);
            if(result)result.innerHTML=`<span style="color:#ffd700">三连⭐！</span><br>+${bonus} Coin +80XP`;
        }else if(allSame){
            const bonus=40; ProgressionManager.addCoins(bonus,'🎰 三连相同！'); ProgressionManager.addXP(40);
            if(result)result.innerHTML=`<span style="color:#ffd700">三连${icons[0]}！</span><br>+${bonus} Coin +40XP`;
        }else if(twoSame&&containsRare){
            const bonus=30; ProgressionManager.addCoins(bonus,'🎰 对子+稀有'); ProgressionManager.addXP(20);
            if(result)result.innerHTML=`<span style="color:#7c4dff">对子+稀有！</span><br>+${bonus} Coin +20XP`;
        }else if(twoSame){
            const bonus=10; ProgressionManager.addCoins(bonus,'🎰 对子');
            if(result)result.innerHTML=`<span style="color:#aaa">对子！</span><br>+${bonus} Coin`;
        }else if(containsRare){
            const bonus=15; ProgressionManager.addCoins(bonus,'🎰 稀有图标');
            if(result)result.innerHTML=`<span style="color:#7c4dff">稀有图标！</span><br>+${bonus} Coin`;
        }else if(icons.includes('❌')){
            if(result)result.innerHTML=`<span style="color:#f44336">运气不佳...</span><br>再接再厉`;
        }else{
            const refund=5; ProgressionManager.addCoins(refund,'🎰 安慰奖');
            if(result)result.innerHTML=`<span style="color:#888">参与奖</span><br>返还 +${refund} Coin`;
        }
    }
};
