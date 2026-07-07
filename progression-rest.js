// ==========================================
// progression-rest.js — 完整重写
// 架构：SupabaseREST → ProgressionManager → AuthManager → Shop
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
    refreshToken: null,

    // ── token 持久化 ──
    _loadTokens: function(){
        try{
            this.token=sessionStorage.getItem('supabase_auth_token')||null;
            this.refreshToken=sessionStorage.getItem('supabase_refresh_token')||null;
            localStorage.removeItem('supabase_auth_token');
            localStorage.removeItem('supabase_refresh_token');
            localStorage.removeItem('supabase_auth_uid');
        }catch(e){}
    },
    _saveTokens: function(){
        try{if(this.token)sessionStorage.setItem('supabase_auth_token',this.token);
            else sessionStorage.removeItem('supabase_auth_token');
            if(this.refreshToken)sessionStorage.setItem('supabase_refresh_token',this.refreshToken);
            else sessionStorage.removeItem('supabase_refresh_token');}catch(e){}
    },
    _storeAuth: function(d){
        if(d.access_token){this.token=d.access_token;}
        if(d.refresh_token){this.refreshToken=d.refresh_token;}
        this._saveTokens();
    },

    _headers: function(){
        var h={'apikey':this.anonKey,'Content-Type':'application/json'};
        return h;
    },
    _authHeaders: function(){
        var h={'apikey':this.anonKey,'Content-Type':'application/json'};
        if(this.token)h['Authorization']='Bearer '+this.token;
        return h;
    },

    // ── token 刷新 ──
    refreshAuth: async function(){
        if(!this.refreshToken)return false;
        try{
            var r=await fetch(this.url+'/auth/v1/token?grant_type=refresh_token',{
                method:'POST',headers:this._headers(),
                body:JSON.stringify({refresh_token:this.refreshToken})
            });
            var d=await r.json();
            if(r.ok&&d.access_token){
                this._storeAuth(d);
                console.log('🔄 token 已刷新');
                return true;
            }
            console.log('⚠️ token 刷新失败: '+(d.error_description||d.msg||r.status));
            return false;
        }catch(e){console.log('⚠️ token 刷新网络错误');return false;}
    },

    dbGet: async function(table,id){
        try{
            var r=await fetch(this.url+'/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id),{headers:this._authHeaders()});
            // 🌟 401/403 → 尝试刷新 token 后重试一次
            if(!r.ok&&(r.status===401||r.status===403)){
                var errBody='';try{errBody=await r.text();}catch(ee){}
                console.log('dbGet '+table+' status='+r.status+' body='+errBody.substring(0,200));
                if(await this.refreshAuth()){
                    r=await fetch(this.url+'/rest/v1/'+table+'?id=eq.'+encodeURIComponent(id),{headers:this._authHeaders()});
                }
            }
            if(!r.ok){
                var errBody2='';try{errBody2=await r.text();}catch(ee){}
                console.log('dbGet '+table+' 最终失败 status='+r.status+' body='+errBody2.substring(0,200));
                return null;
            }
            var a=await r.json();
            var result=a&&a.length?a[0]:null;
            if(!result)console.log('dbGet '+table+' empty for id='+id.substring(0,8)+'...');
            return result;
        }catch(e){console.log('dbGet error:',e.message);return null;}
    },
    dbUpsert: async function(table,row){
        try{
            var r=await fetch(this.url+'/rest/v1/'+table,{method:'POST',headers:Object.assign({},this._authHeaders(),{'Prefer':'resolution=merge-duplicates'}),body:JSON.stringify(row)});
            if(!r.ok&&(r.status===401||r.status===403)){if(await this.refreshAuth())r=await fetch(this.url+'/rest/v1/'+table,{method:'POST',headers:Object.assign({},this._authHeaders(),{'Prefer':'resolution=merge-duplicates'}),body:JSON.stringify(row)});}
            return r.ok;
        }catch(e){return false;}
    },
    nickExists: async function(name){
        try{var r=await fetch(this.url+'/rest/v1/nicknames?nickname=eq.'+encodeURIComponent(name),{headers:this._headers()});if(!r.ok)return false;var a=await r.json();return a&&a.length>0;}catch(e){return false;}
    },
    nickClaim: async function(name,pid){
        try{
            var r=await fetch(this.url+'/rest/v1/nicknames',{method:'POST',headers:this._authHeaders(),body:JSON.stringify({nickname:name,player_id:pid})});
            if(!r.ok&&(r.status===401||r.status===403)){if(await this.refreshAuth())r=await fetch(this.url+'/rest/v1/nicknames',{method:'POST',headers:this._authHeaders(),body:JSON.stringify({nickname:name,player_id:pid})});}
            return r.ok;
        }catch(e){return false;}
    },
    signup: async function(e,p,nick){
        var body={email:e,password:p};
        if(nick)body.data={nickname:nick};
        var r=await fetch(this.url+'/auth/v1/signup',{method:'POST',headers:this._headers(),body:JSON.stringify(body)});
        var d=await r.json();
        if(r.ok&&d.access_token){this._storeAuth(d);return{ok:true,user:d.user};}
        return{ok:false,error:d.msg||d.message||'Signup failed'};
    },
    login: async function(e,p){
        var r=await fetch(this.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:this._headers(),body:JSON.stringify({email:e,password:p})});
        var d=await r.json();
        if(r.ok&&d.access_token){this._storeAuth(d);return{ok:true,user:d.user};}
        return{ok:false,error:d.error_description||d.msg||'Login failed'};
    },
    getUser: async function(){
        if(!this.token)return null;
        try{var r=await fetch(this.url+'/auth/v1/user',{headers:this._authHeaders()});if(!r.ok)return null;return await r.json();}catch(e){return null;}
    },
    updateUserMeta: async function(meta){
        if(!this.token)return false;
        try{var r=await fetch(this.url+'/auth/v1/user',{method:'PUT',headers:this._authHeaders(),body:JSON.stringify({data:meta})});return r.ok;}catch(e){return false;}
    },
    logout: function(){
        this.token=null;this.refreshToken=null;
        sessionStorage.removeItem('supabase_auth_token');
        sessionStorage.removeItem('supabase_refresh_token');
        sessionStorage.removeItem('supabase_auth_uid');
        localStorage.removeItem('supabase_auth_token');
        localStorage.removeItem('supabase_refresh_token');
        localStorage.removeItem('supabase_auth_uid');
    },
    rankedReplayInsert: async function(row){
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replays',{method:'POST',headers:Object.assign({},this._authHeaders(),{'Prefer':'return=representation'}),body:JSON.stringify(row)});
            if(!r.ok)console.log('rankedReplayInsert failed',r.status,await r.text());
            if(!r.ok)return null;
            var rows=await r.json();
            return rows&&rows.length?rows[0].id:null;
        }catch(e){console.log('rankedReplayInsert error',e.message);return null;}
    },
    rankedReplayList: async function(mode, authUid){
        try{
            var base=this.url+'/rest/v1/ranked_replays?select=id,created_at,room_id,player1_id,player2_id,player1_name,player2_name,player1_rank,player2_rank,winner_id,winner_name&order=created_at.desc&limit=100';
            if(mode==='mine'&&authUid)base+='&or=(player1_id.eq.'+encodeURIComponent(authUid)+',player2_id.eq.'+encodeURIComponent(authUid)+')';
            var r=await fetch(base,{headers:this._authHeaders()});
            if(!r.ok)return[];
            return await r.json();
        }catch(e){return[];}
    },
    rankedReplayGet: async function(id){
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replays?select=id,replay_html&id=eq.'+encodeURIComponent(id)+'&limit=1',{headers:this._authHeaders()});
            if(!r.ok)return null;
            var rows=await r.json();
            return rows&&rows.length?rows[0]:null;
        }catch(e){return null;}
    },
    rankedFavoriteList: async function(authUid){
        if(!authUid||!this.token)return[];
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replay_favorites?select=replay_id,custom_title,created_at&user_id=eq.'+encodeURIComponent(authUid)+'&limit=100',{headers:this._authHeaders()});
            if(!r.ok)return[];
            return await r.json();
        }catch(e){return[];}
    },
    rankedFavoriteAdd: async function(authUid,replayId){
        if(!authUid||!this.token)return{ok:false,error:'请先登录'};
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replay_favorites',{method:'POST',headers:Object.assign({},this._authHeaders(),{'Prefer':'return=minimal'}),body:JSON.stringify({user_id:authUid,replay_id:replayId})});
            if(r.ok)return{ok:true};
            var text=await r.text();
            return{ok:false,error:text.indexOf('favorite_limit_reached')>=0?'收藏夹已满':text};
        }catch(e){return{ok:false,error:'网络错误'};}
    },
    rankedFavoriteRemove: async function(authUid,replayId){
        if(!authUid||!this.token)return false;
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replay_favorites?user_id=eq.'+encodeURIComponent(authUid)+'&replay_id=eq.'+encodeURIComponent(replayId),{method:'DELETE',headers:this._authHeaders()});
            return r.ok;
        }catch(e){return false;}
    },
    rankedFavoriteRename: async function(authUid,replayId,title){
        if(!authUid||!this.token)return false;
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replay_favorites?user_id=eq.'+encodeURIComponent(authUid)+'&replay_id=eq.'+encodeURIComponent(replayId),{method:'PATCH',headers:Object.assign({},this._authHeaders(),{'Prefer':'return=minimal'}),body:JSON.stringify({custom_title:title||null})});
            return r.ok;
        }catch(e){return false;}
    },
    rankedReplayDelete: async function(replayId){
        if(!this.token)return false;
        try{
            var r=await fetch(this.url+'/rest/v1/ranked_replays?id=eq.'+encodeURIComponent(replayId),{method:'DELETE',headers:this._authHeaders()});
            return r.ok;
        }catch(e){return false;}
    },
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
        // ── 可见成就 ──
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
        ghost:{name:'幽灵',desc:'全程未暴露视野并击杀敌人',icon:'👻'},
        survivor:{name:'幸存者',desc:'单局存活超过35回合',icon:'🛡️'},
        tianhu:{name:'天胡',desc:'第一回合踩死敌人',icon:'🌅'},dihu:{name:'地胡',desc:'第一回合被敌人踩死',icon:'🌑'},
        // ── 隐藏成就 ──
        grand_slam:{name:'大满贯',desc:'一局内用三种方式击杀',icon:'🎯',hidden:true},
        last_stand_counter:{name:'绝地反杀',desc:'本局曾落后敌方至少25SP，最终获胜并击杀敌人',icon:'⚔️',hidden:true},
        world_end:{name:'世界尽头',desc:'在30×30最大地图中到达四个角落',icon:'🧭',hidden:true},
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
    var SHOP_SKINS = [
        {id:'cell_stardust',slot:'cell',name:'星尘纹理',rarity:'common',price:80,cssClass:'skin-cell-stardust',desc:'棋子表面浮现微光星点。'},
        {id:'cell_crystal',slot:'cell',name:'晶面质感',rarity:'rare',price:180,cssClass:'skin-cell-crystal',desc:'棋子像切割晶体一样反光。'},
        {id:'cell_circuit',slot:'cell',name:'电路刻痕',rarity:'epic',price:420,cssClass:'skin-cell-circuit',desc:'细密光路在棋子表面流动。'},
        {id:'cell_ink',slot:'cell',name:'水墨晕染',rarity:'epic',price:420,cssClass:'skin-cell-ink',desc:'深浅墨痕在颜色之下铺开。'},
        {id:'kill_mark',slot:'kill',name:'终结印记',rarity:'common',price:80,mark:'击破',color:'#ffffff',desc:'击杀时浮现短促印记。'},
        {id:'kill_slash',slot:'kill',name:'斩击残光',rarity:'rare',price:180,mark:'斩',color:'#ffeb3b',desc:'击杀时划过金色残光。'},
        {id:'kill_crown',slot:'kill',name:'胜者冠冕',rarity:'epic',price:420,mark:'冠冕',color:'#ffd54f',desc:'击杀时升起胜者冠冕。'},
        {id:'blast_spark',slot:'blast',name:'火花轰击',rarity:'common',price:80,desc:'轰击特效，第二步补动画。'},
        {id:'blast_arc',slot:'blast',name:'电弧轰击',rarity:'rare',price:180,desc:'轰击特效，第二步补动画。'},
        {id:'blink_trail',slot:'blink',name:'残影闪',rarity:'common',price:80,desc:'闪/树闪特效，第二步补动画。'},
        {id:'blink_leaf',slot:'blink',name:'落叶树闪',rarity:'rare',price:180,desc:'闪/树闪特效，第二步补动画。'}
    ];
    var SHOP_WHISPERS = [
        {id:'gold_triple_echo',tier:'gold',name:'低语·三重回响',text:'若一场猎杀只用一种手段，未免太单薄。脚步、雷鸣与远火，都能成为同一首战歌。'},
        {id:'gold_reversal_blade',tier:'gold',name:'低语·逆势之刃',text:'当能量的天平重重压向对面，别急着认输。真正的反击，往往从最深的低处抬头。'},
        {id:'gold_world_edge',tier:'gold',name:'低语·世界边缘',text:'最大的棋盘藏着最远的路。抵达一个尽头并不够，另外三个尽头仍在沉默。'},
        {id:'gold_fogless_eye',tier:'gold',name:'低语·无雾之眼',text:'有一种胜利不来自杀戮，而来自把每一片迷雾都亲手揭开。'},
        {id:'gold_beast_cage',tier:'gold',name:'低语·困兽之笼',text:'不是所有失败都来自敌人。有些牢笼，是地图自己合上的。'},
        {id:'gold_empty_oath',tier:'gold',name:'低语·空手之誓',text:'力量越多，诱惑越多。若你什么都不用也能赢，棋盘会记住这份克制。'},
        {id:'silver_unseen',tier:'silver',name:'低语·无形',text:'最安静的影子，直到出手前都不该被任何目光捕捉。'},
        {id:'silver_longnight',tier:'silver',name:'低语·长夜',text:'有人赢得很快，有人只是活得足够久。漫长本身，也是一种证明。'},
        {id:'silver_firstlight',tier:'silver',name:'低语·初光',text:'第一步有时不是试探，而是命运提前露出的獠牙。'},
        {id:'silver_darkmoon',tier:'silver',name:'低语·暗月',text:'也有人在第一步就成为传说，只是方式不太体面。'}
    ];
    var SHOP_BOX_COST = 30;
    var RARITY_LABELS = {common:'普通',rare:'稀有',epic:'史诗'};
    var SLOT_LABELS = {cell:'人物格子纹理',blast:'轰击特效',blink:'闪/树闪特效',kill:'击杀特效'};

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
            shop:defaultShopData(),
            achievements:{},dailyChallenges:null,
            _sess:{stomp:0,mine:0,blast:0,explored:0,turns:0,steppedOn:false,seenByEnemy:false,
                   sp:0,minesPl:0,minesDf:0,blinks:0,treeJumps:0,blasts:0,firstTurn:true,
                   usedSkill:false,stuckDeath:false,spComebackWindow:false,cornerVisits:{},won:false,_mapCells:100}
        };
    }

    function defaultShopData(){
        return {ownedSkins:[],equippedSkins:{cell:null,blast:null,blink:null,kill:null},ownedWhispers:[]};
    }
    function normalizeShop(shop){
        var d=defaultShopData();
        shop=shop||{};
        d.ownedSkins=Array.isArray(shop.ownedSkins)?shop.ownedSkins.slice():[];
        d.ownedWhispers=Array.isArray(shop.ownedWhispers)?shop.ownedWhispers.slice():[];
        d.equippedSkins=Object.assign(d.equippedSkins,shop.equippedSkins||{});
        ['cell','blast','blink','kill'].forEach(function(slot){
            if(d.equippedSkins[slot]&&d.ownedSkins.indexOf(d.equippedSkins[slot])<0)d.equippedSkins[slot]=null;
        });
        return d;
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
               stats:Object.assign({},row.stats||{},{_shop:row.shop||defaultShopData()}),achievements:row.achievements,daily_challenges:row.dailyChallenges,
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
        d.shop=normalizeShop(row.shop||(row.stats&&row.stats._shop)||row.shopData);
        if(d.stats&&d.stats._shop)delete d.stats._shop;
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
        if(isDebugCoinAccount()&&amount<0){refreshUI();return;}
        data.coins+=amount; doSave();
        if(amount>0)_toast('🪙 +'+amount+' Coin',reason||'','#ff9800');
        refreshUI();
    }
    function isDebugCoinAccount(){
        return !!(data&&String(data.nickname||'').toLowerCase()==='pyridox');
    }
    function hasCoins(amount){
        return isDebugCoinAccount()||data.coins>=amount;
    }
    function spendCoins(amount){
        if(isDebugCoinAccount()){refreshUI();return true;}
        if(data.coins<amount)return false;
        data.coins-=amount;
        return true;
    }
    function getLevelInfo(){
        var lv=Math.min(data.level,LEVELS.length),cur=LEVELS[lv-1],nxt=lv<LEVELS.length?LEVELS[lv]:null;
        var into=data.xp-cur.xp,need=nxt?nxt.xp-cur.xp:0;
        return{level:lv,title:cur.title,xp:data.xp,xpIntoLevel:into,xpNeeded:need,
               progress:nxt?Math.min(100,Math.round(into/need*100)):100,nextTitle:nxt?nxt.title:'MAX'};
    }

    // ── 成就 ──
    function checkAch(){
        var isGuestGame=ProgressionManager.hasGuest;
        var s=data.stats,sess=data._sess;
        var checks={
            first_win:data.gamesWon>=1,win_10:data.gamesWon>=10,win_50:data.gamesWon>=50,
            stomp_10:s.killsStomp>=10,stomp_50:s.killsStomp>=50,blast_10:s.killsBlast>=10,blast_50:s.killsBlast>=50,
            mine_10:s.killsMine>=10,mine_50:s.killsMine>=50,tree_jump_50:s.treeJumpsUsed>=50,tree_jump_200:s.treeJumpsUsed>=200,
            blink_50:s.blinksUsed>=50,blink_200:s.blinksUsed>=200,mines_placed_30:s.minesPlaced>=30,mines_defused_20:s.minesDefused>=20,
            sp_500:s.totalSPEarned>=500,sp_2000:s.totalSPEarned>=2000,streak_3:data.bestWinStreak>=3,
            streak_5:data.bestWinStreak>=5,streak_10:data.bestWinStreak>=10,
            grand_slam:sess.stomp>0&&sess.mine>0&&sess.blast>0,
            last_stand_counter:sess.spComebackWindow&&sess.won&&(sess.stomp+sess.mine+sess.blast>0),
            ghost:!sess.seenByEnemy&&(sess.stomp>0||sess.mine>0||sess.blast>0),
            survivor:sess.turns>=35,tianhu:sess.firstTurn&&sess.stomp>0,dihu:sess.firstTurn&&sess.steppedOn,
            omniscient:sess.explored>=sess._mapCells,caged:sess.stuckDeath,
            world_end:sess._mapCells===900&&sess.cornerVisits&&sess.cornerVisits['0,0']&&sess.cornerVisits['0,29']&&sess.cornerVisits['29,0']&&sess.cornerVisits['29,29'],
            ascetic:sess.won&&!sess.usedSkill&&sess.turns>=15
        };
        // 🌟 收集本局新成就（游客局虚拟 / 正常局真实，均记录到 _sess._newAch 供总结弹窗展示）
        for(var key in checks){
            if(checks[key]){
                if(!data.achievements[key]){
                    if(isGuestGame){
                        if(!sess._newAch)sess._newAch=[];
                        if(sess._newAch.indexOf(key)===-1)sess._newAch.push(key);
                    }else{
                        // 正常局：真实解锁（记录到 _sess._newAch 供总结展示）
                        if(!sess._newAch)sess._newAch=[];
                        if(sess._newAch.indexOf(key)===-1)sess._newAch.push(key);
                        data.achievements[key]={unlockedAt:Date.now()};
                        addXP(30);
                    }
                }
            }
        }
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
        var cd=document.getElementById('coin-display');if(cd)cd.innerHTML='🪙 '+(isDebugCoinAccount()?'∞':data.coins);

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
    function getSkin(id){for(var i=0;i<SHOP_SKINS.length;i++){if(SHOP_SKINS[i].id===id)return SHOP_SKINS[i];}return null;}
    function getWhisper(id){for(var i=0;i<SHOP_WHISPERS.length;i++){if(SHOP_WHISPERS[i].id===id)return SHOP_WHISPERS[i];}return null;}
    function pickRandom(arr){return arr[Math.floor(Math.random()*arr.length)];}
    function getUnownedSkins(rarity){
        return SHOP_SKINS.filter(function(s){return(!rarity||s.rarity===rarity)&&data.shop.ownedSkins.indexOf(s.id)<0;});
    }
    function getUnownedWhispers(tier){
        return SHOP_WHISPERS.filter(function(w){return(!tier||w.tier===tier)&&data.shop.ownedWhispers.indexOf(w.id)<0;});
    }
    function awardSkinByRarity(rarity){
        var pool=getUnownedSkins(rarity),skin=pool.length?pickRandom(pool):null;
        if(!skin)return{title:'盲盒空响',desc:'没有可用皮肤'};
        data.shop.ownedSkins.push(skin.id);
        return{title:'获得皮肤',desc:skin.name+' · '+(RARITY_LABELS[skin.rarity]||'')};
    }
    function awardWhisper(tier){
        var pool=getUnownedWhispers(tier),w=pool.length?pickRandom(pool):null;
        if(!w)return{title:'低语沉默',desc:'没有可用低语'};
        data.shop.ownedWhispers.push(w.id);
        return{title:tier==='gold'?'获得金色低语':'获得银色低语',desc:w.name};
    }
    function weightedPick(entries){
        var total=entries.reduce(function(sum,e){return sum+e.weight;},0);
        var roll=Math.random()*total;
        for(var i=0;i<entries.length;i++){roll-=entries[i].weight;if(roll<0)return entries[i];}
        return entries[entries.length-1];
    }
    function buySkin(id){
        var skin=getSkin(id);if(!skin)return{ok:false,msg:'皮肤不存在'};
        if(data.shop.ownedSkins.indexOf(id)>=0)return{ok:false,msg:'已经拥有'};
        if(!hasCoins(skin.price))return{ok:false,msg:'Coin 不足'};
        spendCoins(skin.price);data.shop.ownedSkins.push(id);
        doSave();refreshUI();return{ok:true,msg:'已购买 '+skin.name};
    }
    function equipSkin(slot,id){
        if(id){
            var skin=getSkin(id);if(!skin||skin.slot!==slot||data.shop.ownedSkins.indexOf(id)<0)return false;
            data.shop.equippedSkins[slot]=id;
        }else data.shop.equippedSkins[slot]=null;
        doSave();refreshUI();return true;
    }
    function openMysteryBox(){
        if(!hasCoins(SHOP_BOX_COST))return{ok:false,title:'Coin 不足',desc:'需要 '+SHOP_BOX_COST+' Coin'};
        var entries=[
            {weight:25,run:function(){var c=10+Math.floor(Math.random()*21);data.coins+=c;return{title:'Coin 返还',desc:'获得 '+c+' Coin'};}},
            {weight:20,run:function(){var x=20+Math.floor(Math.random()*41);addXP(x);return{title:'XP 奖励',desc:'获得 '+x+' XP'};}}
        ];
        if(getUnownedSkins('common').length)entries.push({weight:24,run:function(){return awardSkinByRarity('common');}});
        if(getUnownedSkins('rare').length)entries.push({weight:13,run:function(){return awardSkinByRarity('rare');}});
        if(getUnownedSkins('epic').length)entries.push({weight:6,run:function(){return awardSkinByRarity('epic');}});
        if(getUnownedWhispers('silver').length)entries.push({weight:8,run:function(){return awardWhisper('silver');}});
        if(getUnownedWhispers('gold').length)entries.push({weight:4,run:function(){return awardWhisper('gold');}});
        spendCoins(SHOP_BOX_COST);
        var result=weightedPick(entries).run();
        doSave();refreshUI();result.ok=true;return result;
    }
    function getEquippedSkin(slot){return getSkin(data.shop.equippedSkins[slot]);}

    // ══════════════════════════════════════
    return {
        // ── 生命周期 ──
        async init(){
            SupabaseREST._loadTokens();
            var tok=SupabaseREST.token;
            try{authUid=sessionStorage.getItem('supabase_auth_uid')||null;}catch(e){}
            if(tok){
                var user=await SupabaseREST.getUser();
                if(user){authUid=user.id;try{sessionStorage.setItem('supabase_auth_uid',authUid);}catch(e){}console.log('🔑 uid='+authUid);}
                else{
                    console.log('⚠️ token 可能过期，尝试刷新...');
                    if(await SupabaseREST.refreshAuth()){
                        user=await SupabaseREST.getUser();
                        if(user){authUid=user.id;try{sessionStorage.setItem('supabase_auth_uid',authUid);}catch(e){}console.log('🔑 刷新后 uid='+authUid);}
                        else{console.log('⚠️ 刷新后仍无效，保留本地登录态等待下次重试');}
                    }else{console.log('⚠️ token 刷新失败，保留本地登录态等待下次重试');}
                }
            }
            // 清除旧格式 ID
            var oldId=localStorage.getItem('digitalfog_player_id');
            if(oldId&&oldId.indexOf('u_')===0)localStorage.removeItem('digitalfog_player_id');
            await load();
            refreshUI();
            // 踢同账号旧连接
            tok=SupabaseREST.token;
            if(tok&&typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:tok,authUid:authUid});
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
            try{sessionStorage.setItem('supabase_auth_uid',uid);}catch(e){}
            var loginRow=null;
            if(SupabaseREST.token){
                try{loginRow=await SupabaseREST.dbGet('player_progress',uid);}catch(e){}
            }
            if(loginRow){
                applyRow(loginRow);
                data.email=email||data.email;
                if(nick)data.nickname=nick;
                cacheSave();
                refreshUI();
                console.log('✅ onLogin cloud row: nick='+(data.nickname||'(空)')+' coins='+data.coins);
                return;
            }
            // 🌟 昵称优先：传入 > data已有 > 云拉取 > Auth元数据 > 空
            if(nick){
                data.nickname=nick;
            }else if(!data.nickname&&SupabaseREST.token){
                // 先试云拉取
                var row=await SupabaseREST.dbGet('player_progress',uid);
                if(row&&row.nickname){
                    data.nickname=row.nickname;
                    console.log('🔍 从云补拉昵称: '+row.nickname);
                    // 同步到 Auth 元数据（老用户迁移，保证后续登录永不忘）
                    SupabaseREST.updateUserMeta({nickname:row.nickname});
                }
                // 云失败就取 Auth user_metadata（和邮箱密码同级永久存储）
                else{
                    var user=await SupabaseREST.getUser();
                    if(user&&user.user_metadata&&user.user_metadata.nickname){
                        data.nickname=user.user_metadata.nickname;
                        console.log('🔍 从Auth元数据恢复昵称: '+data.nickname);
                    }else{
                        console.log('🔍 昵称获取失败（云和Auth元数据均无）');
                    }
                }
            }
            if(coinBonus!==undefined)data.coins=coinBonus;
            cacheSave();
            if(SupabaseREST.token)await saveNow();
            refreshUI();
            console.log('✅ onLogin: nick='+(data.nickname||'(空)')+' coins='+data.coins);
        },
        onLogout:function(){
            authUid=null;SupabaseREST.token=null;SupabaseREST.refreshToken=null;
            try{sessionStorage.removeItem('supabase_auth_uid');}catch(e){}
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
        onSPGapChecked:function(mySp,maxEnemySp){
            if(maxEnemySp-mySp>=25)data._sess.spComebackWindow=true;
        },
        onCornerVisited:function(r,c,N){
            if(N!==30)return;
            if((r===0||r===29)&&(c===0||c===29)){
                data._sess.cornerVisits[r+','+c]=true;
                checkAch();doSave();
            }
        },
        async onGameEnd(won){
            var self=ProgressionManager, isGuest=!(authUid&&SupabaseREST.token);
            var isGuestGame=!!(self.hasGuest||isGuest);
            data.gamesPlayed++;
            var t=_today();
            var xpEarned=0, coinEarned=0, newAchList=[];

            if(isGuestGame){
                // ══════════════════════════════════
                // 🚫 游客局：0 XP、0 成就、少量 Coin + 每日封顶 30
                // ══════════════════════════════════
                var GUEST_COIN_CAP=30;
                var guestKey='guest_coin_'+t;
                var earnedToday=parseInt(localStorage.getItem(guestKey)||'0');
                var remain=Math.max(0,GUEST_COIN_CAP-earnedToday);
                var base=3;
                if(won){data._sess.won=true;data.gamesWon++;base=10;}
                else{data.winStreak=0;if(data._sess.turns>=5)base=5;}
                coinEarned=Math.min(base,remain);
                if(coinEarned>0){localStorage.setItem(guestKey,earnedToday+coinEarned);addCoins(coinEarned,'游客局'+(won?'胜利':'完成'));}
            }else{
                // ══════════════════════════════════
                // ✅ 正常局：完整 XP + 成就 + Coin
                // ══════════════════════════════════
                xpEarned=20;addXP(20);
                if(data.dailyGameCoinDate!==t){data.dailyGameCoins=0;data.dailyGameCoinDate=t;}
                if(data.dailyGameCoins<100){coinEarned+=10;data.dailyGameCoins+=10;addCoins(10,'对局完成');}
                if(won){
                    data._sess.won=true;data.gamesWon++;data.winStreak++;
                    if(data.winStreak>data.bestWinStreak)data.bestWinStreak=data.winStreak;
                    var b=80;if(data.winStreak>=3)b+=25;if(data.winStreak>=5)b+=50;if(data.winStreak>=10)b+=100;
                    xpEarned+=b;addXP(b);
                    if(data.dailyGameCoinDate!==t){data.dailyGameCoins=0;data.dailyGameCoinDate=t;}
                    if(data.dailyGameCoins<100){coinEarned+=15;data.dailyGameCoins+=15;addCoins(15,'胜利奖励');}
                }else{data.winStreak=0;if(data._sess.turns>=5){xpEarned+=10;addXP(10);}}
                if(self.isRankedGame)rankedGame(won);
                checkAch();
            }
            checkDaily();
            await saveNow();
            refreshUI();
            // 🌟 收集本局新成就（游客虚/正常实）
            newAchList=(data._sess._newAch||[]).slice();
            delete data._sess._newAch;
            // 🌟 对局结束总结弹窗（持久，点击 → 收回）
            _gameEndSummary(xpEarned,coinEarned,won,isGuestGame,newAchList,self.hasGuest);
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
        doCheckin:async function(){
            var t=_today();if(data.dailyCheckinDate===t)return false;
            if(data.dailyCheckinDate===_yesterday())data.checkinStreak++;else data.checkinStreak=1;
            data.dailyCheckinDate=t;var r=20+data.checkinStreak*2;if(r>30)r=30;
            addCoins(r,'签到第'+data.checkinStreak+'天');
            await saveNow();
            return true;
        },
        claimDaily:function(id){
            if(!data.dailyChallenges)return;
            for(var i=0;i<data.dailyChallenges.challenges.length;i++){var ch=data.dailyChallenges.challenges[i];if(ch.id===id&&ch.completed&&!ch.claimed){ch.claimed=true;addXP(50+Math.floor(Math.random()*30));doSave();refreshUI();return;}}
        },

        // ── 查询 ──
        captureSnapshot:function(){
            return data?JSON.parse(JSON.stringify(data)):null;
        },
        restoreSnapshot:async function(snapshot){
            if(!snapshot)return false;
            data=JSON.parse(JSON.stringify(snapshot));
            cacheSave();
            await saveNow();
            refreshUI();
            return true;
        },
        getLevelInfo:getLevelInfo,
        getCoins:function(){return isDebugCoinAccount()?Infinity:data.coins;},
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
        getShopState:function(){return JSON.parse(JSON.stringify(data.shop));},
        getSkinCatalog:function(){return SHOP_SKINS.slice();},
        getWhisperCatalog:function(){return SHOP_WHISPERS.slice();},
        getSlotLabels:function(){return Object.assign({},SLOT_LABELS);},
        getRarityLabels:function(){return Object.assign({},RARITY_LABELS);},
        buySkin:buySkin,
        equipSkin:equipSkin,
        openMysteryBox:openMysteryBox,
        getEquippedSkin:getEquippedSkin,
        getSkinById:getSkin,
        getWhisperById:getWhisper,
        getBoxCost:function(){return SHOP_BOX_COST;},
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
        // ProgressionManager.init 已处理 token 恢复和 socket 注册
    },

    toggleAuthModal:function(){
        var m=document.getElementById('auth-modal');
        if(m.style.display==='flex'){m.style.display='none';return;}
        if(SupabaseREST.token){if(confirm('已登录\n\n退出登录？'))this.logout();return;}
        m.style.display='flex';this.switchAuthTab('login');
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
            var row=await SupabaseREST.dbGet('player_progress',r.user.id);
            if(row){
                // 同步昵称到 Auth 元数据（保证后续登录永不忘）
                if(row.nickname)SupabaseREST.updateUserMeta({nickname:row.nickname});
                await ProgressionManager.onLogin(r.user.id,email,row.nickname||'',row.coins||0);
            }else{
                // dbGet 401/失败 → 从 Auth user_metadata 取昵称，不丢数据
                var user=await SupabaseREST.getUser();
                var metaNick=(user&&user.user_metadata&&user.user_metadata.nickname)?user.user_metadata.nickname:'';
                await ProgressionManager.onLogin(r.user.id,email,metaNick,0);
            }
            document.getElementById('auth-modal').style.display='none';
            if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:SupabaseREST.token,authUid:r.user.id});
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
            // ② 注册（昵称一并存入Auth元数据，和邮箱密码同级永久存储）
            var r=await SupabaseREST.signup(email,pw,nick);
            if(!r.ok){err.textContent=r.error;err.style.display='';btn.disabled=false;btn.textContent='注 册';return;}
            // ③ 占昵称
            await SupabaseREST.nickClaim(nick,r.user.id);
            // ④ 写完整数据
            var srow={id:r.user.id,xp:0,level:1,games_played:0,games_won:0,win_streak:0,best_win_streak:0,coins:50,daily_checkin_date:'',checkin_streak:0,daily_game_coins:0,daily_game_coin_date:'',email:email,nickname:nick,rank_score:100,rank_tier:'bronze',season_games:0,season_wins:0,season_start:'',stats:{killsStomp:0,killsMine:0,killsBlast:0,deaths:0,minesPlaced:0,minesDefused:0,blinksUsed:0,treeJumpsUsed:0,blastsUsed:0,totalSPEarned:0,totalCellsExplored:0,mudHits:0,_shop:{ownedSkins:[],equippedSkins:{cell:null,blast:null,blink:null,kill:null},ownedWhispers:[]}},achievements:{},daily_challenges:null,updated_at:new Date().toISOString()};
            await SupabaseREST.dbUpsert('player_progress',srow);
            // ⑤ 设置本地
            await ProgressionManager.onLogin(r.user.id,email,nick,50);
            document.getElementById('auth-modal').style.display='none';
            if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:SupabaseREST.token,authUid:r.user.id});
            _bigReg(nick,email);
            btn.disabled=false;btn.textContent='注 册';
        }catch(e){err.textContent='注册失败';err.style.display='';btn.disabled=false;btn.textContent='注 册';}
    },

    checkin:async function(){
        if(!SupabaseREST.token){alert('请先登录再签到');return;}
        if(!await ProgressionManager.doCheckin())alert('今天已经签到过了！');
    },

    logout:function(){
        SupabaseREST.logout();
        if(typeof socket!=='undefined'&&socket&&socket.emit)socket.emit('register_auth',{token:'',authUid:null});
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

// 🌟 对局结束总结弹窗（持久显示，点击 → 收回）
function _gameEndSummary(xp,coins,won,isGuest,newAchList,hasGuest){
    var c=document.getElementById('toast-container');
    if(!c)return;
    var el=document.createElement('div');
    el.className='prog-toast game-end-summary';
    el.style.borderLeftColor=won?'#4caf50':'#ff9800';
    el.style.maxWidth='320px';
    el.style.cursor='default';
    var lines=[];
    // 标题
    lines.push('<div class="prog-toast-title">'+(won?'🏆 胜利！':'💀 失败')+(isGuest?' <span style="color:#ff9800;font-size:11px">游客局</span>':'')+'</div>');
    if(isGuest){
        if(coins>0)lines.push('<div class="prog-toast-msg">🪙 +'+coins+' Coin'+(hasGuest?' ⚠️含游客':'')+'</div>');
        else lines.push('<div class="prog-toast-msg">🪙 今日上限已达</div>');
        lines.push('<div class="prog-toast-msg" style="color:#999;font-size:11px">⚠ 无XP/成就 · 不计入统计</div>');
    }else{
        if(xp>0)lines.push('<div class="prog-toast-msg">⭐ +'+xp+' XP</div>');
        if(coins>0)lines.push('<div class="prog-toast-msg">🪙 +'+coins+' Coin</div>');
    }
    // 虚拟成就 / 真实成就
    if(newAchList&&newAchList.length>0){
        var label=isGuest?'🏅 本次达成（不计入）：':'🏅 新成就解锁：';
        lines.push('<div style="font-size:11px;color:'+(isGuest?'#999':'#4caf50')+';margin-top:6px;border-top:1px solid #eee;padding-top:4px">'+label+'</div>');
        var achDefs=ProgressionManager.getAchievements();
        for(var i=0;i<newAchList.length;i++){
            var key=newAchList[i];
            var ach=achDefs[key];
            if(ach)lines.push('<div style="font-size:12px;color:#555;margin-top:2px">'+ach.icon+' '+ach.name+'</div>');
        }
    }
    // 收回按钮
    lines.push('<div style="text-align:right;margin-top:10px"><button class="summary-dismiss-btn">→</button></div>');
    el.innerHTML=lines.join('');
    el.querySelector('.summary-dismiss-btn').onclick=function(){
        el.style.opacity='0';el.style.transform='translateX(120%)';
        setTimeout(function(){el.remove();},300);
    };
    c.appendChild(el);
}

// ══════════════════════════════════════
//  toggleStats
// ══════════════════════════════════════
function toggleStats(){
    var modal=document.getElementById('stats-modal');
    if(modal.style.display==='flex'){modal.style.display='none';return;}
    var stats=ProgressionManager.getStats(),achDefs=ProgressionManager.getAchievements(),unlocked=ProgressionManager.getUnlockedAch();
    var whisperHintAch={ghost:true,survivor:true,tianhu:true,dihu:true};
    var achHTML='';for(var key in achDefs){var u=!!unlocked[key];var hidden=achDefs[key].hidden&&!u;var whisperHint=whisperHintAch[key]&&!u;achHTML+='<div class="ach-item '+(u?'unlocked':'locked')+'"><span class="ach-icon">'+(hidden?'❓':achDefs[key].icon)+'</span><div><div class="ach-name">'+(hidden?'？？？':achDefs[key].name)+'</div><div class="ach-desc">'+(hidden?'达成条件后揭晓':(whisperHint?'提示藏在低语中':achDefs[key].desc))+'</div></div></div>';}
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
//  Shop
// ══════════════════════════════════════
var Shop={
    tab:'store',
    esc:function(t){return String(t==null?'':t).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});},
    open:function(){var m=document.getElementById('shop-modal');if(!m)return;m.style.display='flex';this.render();},
    close:function(){var m=document.getElementById('shop-modal');if(m)m.style.display='none';},
    switchTab:function(tab){this.tab=tab;this.render();},
    rarityClass:function(r){return'shop-rarity-'+r;},
    render:function(){
        var body=document.getElementById('shop-body');if(!body)return;
        document.querySelectorAll('.shop-tab').forEach(function(b){b.classList.remove('active');});
        var active=document.getElementById('shop-tab-'+(this.tab==='owned'?'owned':'store'));if(active)active.classList.add('active');
        body.innerHTML=this.tab==='owned'?this.renderOwned():this.renderStore();
    },
    renderStore:function(){
        var state=ProgressionManager.getShopState(),skins=ProgressionManager.getSkinCatalog(),rar=ProgressionManager.getRarityLabels(),slots=ProgressionManager.getSlotLabels(),self=this;
        var html='<div class="shop-box"><div style="font-weight:900;font-size:18px">神秘盲盒</div><div class="shop-meta">可能获得 Coin / XP / 皮肤 / 低语。无保底，低语只能从这里获得。</div><button onclick="Shop.openBox()">开启 '+ProgressionManager.getBoxCost()+' Coin</button><div class="shop-result" id="shop-box-result"></div></div>';
        html+='<div class="shop-grid">';
        skins.forEach(function(s){
            var owned=state.ownedSkins.indexOf(s.id)>=0,eq=state.equippedSkins[s.slot]===s.id;
            html+='<div class="shop-card"><div class="shop-card-name">'+self.esc(s.name)+'</div>'
                +'<div class="shop-meta">'+self.esc(slots[s.slot]||s.slot)+' · <span class="'+self.rarityClass(s.rarity)+'">'+self.esc(rar[s.rarity]||s.rarity)+'</span></div>'
                +'<div class="shop-meta">'+self.esc(s.desc||'')+'</div>'
                +'<button '+(owned?'disabled':'')+' onclick="Shop.buy(\''+s.id+'\')">'+(owned?(eq?'已装备':'已拥有'):'购买 '+s.price+' Coin')+'</button></div>';
        });
        return html+'</div>';
    },
    renderOwned:function(){
        var state=ProgressionManager.getShopState(),skins=ProgressionManager.getSkinCatalog(),whispers=ProgressionManager.getWhisperCatalog(),slots=ProgressionManager.getSlotLabels(),self=this;
        var html='<div class="shop-box"><div style="font-weight:900;margin-bottom:8px">已装备</div>';
        Object.keys(slots).forEach(function(slot){
            var owned=skins.filter(function(s){return s.slot===slot&&state.ownedSkins.indexOf(s.id)>=0;});
            html+='<label class="replay-option" style="margin:0 8px 8px 0">'+self.esc(slots[slot])+' <select onchange="Shop.equip(\''+slot+'\',this.value)"><option value="">无</option>';
            owned.forEach(function(s){html+='<option value="'+s.id+'" '+(state.equippedSkins[slot]===s.id?'selected':'')+'>'+self.esc(s.name)+'</option>';});
            html+='</select></label>';
        });
        html+='</div><div style="font-weight:900;margin:12px 0 8px">低语</div>';
        var ownedWhispers=whispers.filter(function(w){return state.ownedWhispers.indexOf(w.id)>=0;});
        if(!ownedWhispers.length)return html+'<div class="shop-meta">还没有获得低语。低语只能从神秘盲盒中随机出现。</div>';
        ownedWhispers.forEach(function(w){html+='<div class="whisper-card '+w.tier+'"><div style="font-weight:900">'+self.esc(w.name)+'</div><div style="font-size:13px;color:#555;margin-top:4px">'+self.esc(w.text)+'</div></div>';});
        return html;
    },
    buy:function(id){var r=ProgressionManager.buySkin(id);alert(r.msg);this.render();},
    equip:function(slot,id){ProgressionManager.equipSkin(slot,id||null);this.render();},
    openBox:function(){var r=ProgressionManager.openMysteryBox(),el=document.getElementById('shop-box-result');if(el)el.textContent=r.title+'：'+r.desc;this.render();setTimeout(function(){var e=document.getElementById('shop-box-result');if(e)e.textContent=r.title+'：'+r.desc;},0);}
};
var Lottery=Shop;
