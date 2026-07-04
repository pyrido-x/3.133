const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 开启静态资源托管 + JSON 解析，确保前端资源正常加载
app.use(express.static(__dirname));
app.use(express.json());

// ==========================================
// 0. 用户账户系统
// ==========================================
const USERS_FILE = path.join(__dirname, 'users.json');
const REGLIMIT_FILE = path.join(__dirname, 'reg_limit.json');
const TOKENS = new Map(); // token → username（会话管理）

// IP 注册限制数据结构：{ "1.2.3.4": { count: 5, firstAt: 1710000000000, timestamps: [...] } }
function loadRegLimit() {
    try {
        if (fs.existsSync(REGLIMIT_FILE)) return JSON.parse(fs.readFileSync(REGLIMIT_FILE, 'utf-8'));
    } catch (e) { console.error('读取限制文件失败:', e.message); }
    return {};
}

function saveRegLimit(data) {
    fs.writeFileSync(REGLIMIT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 获取客户端真实 IP（兼容代理 / 本地）
function getClientIP(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
    return req.socket?.remoteAddress || req.ip || req.connection?.remoteAddress || '127.0.0.1';
}

// 检查该 IP 是否允许注册，返回 null=放行，或返回拒绝原因字符串
function checkRegLimit(ip) {
    const now = Date.now();
    const limits = loadRegLimit();
    const entry = limits[ip];

    if (!entry) return null; // 新 IP，放行

    // 1. 终身上限：每个 IP 最多 15 个账号
    if (entry.count >= 15) return '该设备注册账号已达上限';

    // 2. 冷却时间：两次注册至少间隔 30 秒
    if (entry.timestamps && entry.timestamps.length > 0) {
        const lastReg = entry.timestamps[entry.timestamps.length - 1];
        const secondsSinceLast = (now - lastReg) / 1000;
        if (secondsSinceLast < 30) {
            return `请 ${Math.ceil(30 - secondsSinceLast)} 秒后再试`;
        }
    }

    // 3. 滑动窗口：24 小时内最多 5 个账号
    if (entry.timestamps) {
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const recent = entry.timestamps.filter(ts => ts > oneDayAgo);
        if (recent.length >= 5) return '24小时内注册已达上限，请明天再试';
    }

    return null; // 放行
}

// 记录一次注册
function recordRegistration(ip) {
    const now = Date.now();
    const limits = loadRegLimit();
    if (!limits[ip]) {
        limits[ip] = { count: 0, firstAt: now, timestamps: [] };
    }
    limits[ip].count++;
    limits[ip].timestamps.push(now);
    // 只保留最近 30 天的时间戳，控制文件大小
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    limits[ip].timestamps = limits[ip].timestamps.filter(ts => ts > cutoff);
    // 清理超过 90 天无活动的 IP 记录
    for (const key of Object.keys(limits)) {
        if (key === ip) continue;
        const lastTs = limits[key].timestamps[limits[key].timestamps.length - 1] || limits[key].firstAt;
        if (now - lastTs > 90 * 24 * 60 * 60 * 1000) delete limits[key];
    }
    saveRegLimit(limits);
}

// ── 登录限流（防暴力破解）──
const LOGIN_ATTEMPTS = new Map(); // "ip:username" → { count, firstAt, blockedUntil }

function checkLoginLimit(ip, username) {
    const now = Date.now();
    const key = `${ip}:${username}`;

    // 清理过期记录
    for (const [k, v] of LOGIN_ATTEMPTS) {
        if (now - v.firstAt > 15 * 60 * 1000) LOGIN_ATTEMPTS.delete(k);
    }

    const entry = LOGIN_ATTEMPTS.get(key);
    if (entry && entry.blockedUntil && now < entry.blockedUntil) {
        const remaining = Math.ceil((entry.blockedUntil - now) / 1000);
        return `密码错误次数过多，请 ${Math.ceil(remaining / 60)} 分钟后再试`;
    }

    // 同 IP 不同用户名的登录尝试也限制
    let ipTotal = 0;
    for (const [k, v] of LOGIN_ATTEMPTS) {
        if (k.startsWith(ip + ':') && now - v.firstAt < 15 * 60 * 1000) {
            ipTotal += v.count;
        }
    }
    if (ipTotal >= 30) return '登录尝试过于频繁，请15分钟后再试';

    return null;
}

function recordLoginAttempt(ip, username, success) {
    const now = Date.now();
    const key = `${ip}:${username}`;
    if (!LOGIN_ATTEMPTS.has(key)) {
        LOGIN_ATTEMPTS.set(key, { count: 0, firstAt: now, blockedUntil: 0 });
    }
    const entry = LOGIN_ATTEMPTS.get(key);

    if (success) {
        LOGIN_ATTEMPTS.delete(key); // 登录成功，清除记录
        return;
    }

    entry.count++;
    // 5 次失败后封禁 15 分钟
    if (entry.count >= 5) {
        entry.blockedUntil = now + 15 * 60 * 1000;
    }
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        }
    } catch (e) { console.error('读取用户文件失败:', e.message); }
    return {};
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(salt + password + '3133salt').digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ── REST：注册 ──
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, msg: '用户名和密码不能为空' });
    if (username.length < 2 || username.length > 16) return res.json({ ok: false, msg: '用户名需 2-16 个字符' });
    if (password.length < 4) return res.json({ ok: false, msg: '密码至少 4 位' });
    if (!/^[\w一-鿿]+$/.test(username)) return res.json({ ok: false, msg: '用户名只能包含字母、数字、下划线、中文' });

    const users = loadUsers();
    if (users[username]) return res.json({ ok: false, msg: '用户名已存在' });

    // ★ IP 防滥用检查
    const ip = getClientIP(req);
    const limitMsg = checkRegLimit(ip);
    if (limitMsg) return res.json({ ok: false, msg: limitMsg });

    const salt = crypto.randomBytes(16).toString('hex');
    users[username] = {
        passwordHash: hashPassword(password, salt), salt,
        stats: { wins: 0, losses: 0, kills: 0, games: 0, stompKills: 0, blastKills: 0, mineKills: 0, defuses: 0, blinks: 0, cellsExplored: 0, maxTurnsSurvived: 0, totalCoinsEarned: 0 },
        coins: 0, rating: 1000,
        lastDailyClaim: null,
        inventory: [], equipped: {},
        achievements: {}, achievementProgress: {},
        loginStreak: { count: 1, lastDate: new Date().toISOString().split('T')[0] },
        dailyTasks: null,
        lastSeasonReset: getCurrentSeason().number,
        createdAt: Date.now()
    };
    saveUsers(users);

    // ★ 记录本次注册
    recordRegistration(ip);

    const token = generateToken();
    TOKENS.set(token, username);
    res.json({ ok: true, token, username, coins: 0, rating: 1000 });
});

// ── REST：登录 ──
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, msg: '用户名和密码不能为空' });

    const ip = getClientIP(req);

    // ★ 登录限流检查
    const limitMsg = checkLoginLimit(ip, username);
    if (limitMsg) return res.json({ ok: false, msg: limitMsg });

    const users = loadUsers();
    const user = users[username];
    if (!user) {
        recordLoginAttempt(ip, username, false);
        return res.json({ ok: false, msg: '用户名不存在' });
    }

    if (user.passwordHash !== hashPassword(password, user.salt)) {
        recordLoginAttempt(ip, username, false);
        return res.json({ ok: false, msg: '密码错误' });
    }

    recordLoginAttempt(ip, username, true);

    // 📅 登录连击
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (!user.loginStreak) user.loginStreak = { count: 0, lastDate: null };
    if (user.loginStreak.lastDate === yesterday) {
        user.loginStreak.count++; // 连续登录
    } else if (user.loginStreak.lastDate !== today) {
        user.loginStreak.count = 1; // 断签重置
    }
    user.loginStreak.lastDate = today;

    // 📅 赛季软重置检查
    const season = getCurrentSeason();
    if (!user.lastSeasonReset || user.lastSeasonReset < season.number) {
        if (user.lastSeasonReset && user.lastSeasonReset < season.number) {
            // 新赛季：软重置段位
            const oldTier = getTier(user.rating || 1000);
            if (!user.seasonBadges) user.seasonBadges = {};
            user.seasonBadges[`S${user.lastSeasonReset}`] = oldTier.name;
            user.rating = Math.round(1000 + (user.rating || 1000) * SEASON_CONFIG.softResetFactor);
        }
        user.lastSeasonReset = season.number;
    }

    // 📋 每日任务（若日期变更则刷新）
    if (!user.dailyTasks || user.dailyTasks.date !== today) {
        user.dailyTasks = { date: today, tasks: generateDailyTasks(), progress: [0, 0, 0], claimed: [false, false, false] };
    }

    saveUsers(users);

    const token = generateToken();
    TOKENS.set(token, username);
    res.json({
        ok: true, token, username, stats: user.stats,
        coins: user.coins || 0, rating: user.rating || 1000,
        inventory: user.inventory || [],
        equipped: user.equipped || {},
        streak: user.loginStreak,
        season
    });
});

// ── REST：验证 token 有效性 ──
app.get('/api/verify', (req, res) => {
    const token = req.query.token;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false });
    const users = loadUsers();
    const user = users[username];
    res.json({ ok: true, username, stats: user ? user.stats : null, coins: user ? (user.coins || 0) : 0, rating: user ? (user.rating || 1000) : 1000 });
});

// ── REST：获取用户完整状态（币 + 段位 + 统计）──
app.get('/api/user-status', (req, res) => {
    const token = req.query.token;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });
    const status = getUserStatus(username);
    res.json({ ok: true, ...status });
});

// ── 🪙 REST：领取每日登录奖励 ──
app.post('/api/claim-daily', (req, res) => {
    const { token } = req.body;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });

    const users = loadUsers();
    const user = users[username];
    if (!user) return res.json({ ok: false, msg: '用户不存在' });

    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
    if (user.lastDailyClaim === today) {
        return res.json({ ok: false, msg: '今日已领取' });
    }

    user.coins = (user.coins || 0) + 1;
    user.lastDailyClaim = today;
    saveUsers(users);
    res.json({ ok: true, coins: user.coins, msg: '领取成功！+1 🪙' });
});

// ==========================================
// 🏆 段位系统
// ==========================================
const TIERS = [
    { name: '青铜', min: 0,    max: 899,  icon: '🥉', color: '#cd7f32' },
    { name: '白银', min: 900,  max: 1099, icon: '🥈', color: '#a0a0a0' },
    { name: '黄金', min: 1100, max: 1299, icon: '🥇', color: '#ffd700' },
    { name: '铂金', min: 1300, max: 1499, icon: '💎', color: '#4db6ac' },
    { name: '钻石', min: 1500, max: 1699, icon: '👑', color: '#7c4dff' },
    { name: '大师', min: 1700, max: 1899, icon: '🏅', color: '#ff6d00' },
    { name: '王者', min: 1900, max: 9999, icon: '🌟', color: '#ff1744' }
];

function getTier(rating) {
    return TIERS.find(t => rating >= t.min && rating <= t.max) || TIERS[0];
}

// Elo 预期得分
function expectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// 计算新段位分（K=32）
function calcNewRatings(ratingA, ratingB, aWon) {
    const eA = expectedScore(ratingA, ratingB);
    const scoreA = aWon ? 1 : 0;
    const scoreB = aWon ? 0 : 1;
    const K = 32;
    const newA = Math.round(ratingA + K * (scoreA - eA));
    const newB = Math.round(ratingB + K * (scoreB - (1 - eA)));
    return { newA, newB };
}

// ==========================================
// 🪙 货币系统工具函数
// ==========================================
function awardCoins(username, amount) {
    const users = loadUsers();
    const user = users[username];
    if (!user) return;
    user.coins = (user.coins || 0) + amount;
    saveUsers(users);

    // 广播更新后的币数给该用户的所有 socket
    for (const [id, s] of io.sockets.sockets) {
        if (s.username === username) {
            s.emit('coins_updated', { coins: user.coins });
        }
    }
}

function awardRating(username, newRating) {
    const users = loadUsers();
    const user = users[username];
    if (!user) return;
    const oldRating = user.rating || 1000;
    user.rating = newRating;
    saveUsers(users);

    const newTier = getTier(newRating);
    const oldTier = getTier(oldRating);

    // 广播更新后的段位给该用户
    for (const [id, s] of io.sockets.sockets) {
        if (s.username === username) {
            s.emit('rating_updated', {
                rating: newRating,
                oldRating,
                tier: newTier,
                tierUp: newTier.name !== oldTier.name && newRating > oldRating,
                tierDown: newTier.name !== oldTier.name && newRating < oldRating
            });
        }
    }
}

// 获取用户完整状态（币 + 段位）
function getUserStatus(username) {
    const users = loadUsers();
    const user = users[username];
    if (!user) return { coins: 0, rating: 1000, tier: getTier(1000), lastDailyClaim: null, stats: {}, streak: { count: 0 } };
    return {
        coins: user.coins || 0,
        rating: user.rating || 1000,
        tier: getTier(user.rating || 1000),
        lastDailyClaim: user.lastDailyClaim || null,
        stats: user.stats || {},
        streak: user.loginStreak || { count: 0 },
        inventory: user.inventory || [],
        equipped: user.equipped || {}
    };
}

// ==========================================
// 🛒 商店系统
// ==========================================
const SHOP_ITEMS = [
    // 皮肤色
    { id: 'skin_purple',  type: 'skin',  name: '紫焰',     icon: '🟣', cost: 5,  desc: '紫色阵营皮肤' },
    { id: 'skin_black',   type: 'skin',  name: '暗影',     icon: '⚫', cost: 8,  desc: '黑色阵营皮肤' },
    { id: 'skin_cyan',    type: 'skin',  name: '冰霜',     icon: '🩵', cost: 5,  desc: '青色阵营皮肤' },
    { id: 'skin_pink',    type: 'skin',  name: '樱花',     icon: '🌸', cost: 8,  desc: '粉色阵营皮肤' },
    { id: 'skin_gold',    type: 'skin',  name: '鎏金',     icon: '✨', cost: 15, desc: '金色阵营皮肤' },
    // 称号
    { id: 'title_veteran',  type: 'title', name: '老手',   icon: '🎖️', cost: 3,  desc: '名号：老手' },
    { id: 'title_slayer',   type: 'title', name: '杀手',   icon: '🗡️', cost: 5,  desc: '名号：杀手' },
    { id: 'title_tactician',type: 'title', name: '战术家', icon: '🧠', cost: 8,  desc: '名号：战术家' },
    { id: 'title_legend',   type: 'title', name: '传奇',   icon: '👑', cost: 20, desc: '名号：传奇' },
    // 击杀特效
    { id: 'effect_fire',    type: 'effect', name: '火焰击杀', icon: '🔥', cost: 10, desc: '击杀时显示火焰特效' },
    { id: 'effect_lightning',type:'effect', name: '雷电击杀', icon: '⚡', cost: 10, desc: '击杀时显示雷电特效' },
    { id: 'effect_confetti', type: 'effect', name: '彩带击杀', icon: '🎊', cost: 15, desc: '击杀时显示彩带特效' },
];

// ==========================================
// 🎯 成就系统
// ==========================================
const ACHIEVEMENTS = [
    { id: 'first_blood',   name: '第一滴血', icon: '🩸', desc: '首次击杀敌人',         goal: 1,  stat: 'kills' },
    { id: 'assassin',      name: '暗杀者',   icon: '🥷', desc: '踩死10个敌人',         goal: 10, stat: 'stompKills' },
    { id: 'demolition',    name: '爆破专家', icon: '💣', desc: '轰杀20个敌人',         goal: 20, stat: 'blastKills' },
    { id: 'sweeper',       name: '排雷兵',   icon: '🧹', desc: '拆除30颗地雷',         goal: 30, stat: 'defuses' },
    { id: 'miner',         name: '地雷大师', icon: '💥', desc: '用地雷炸死15个敌人',   goal: 15, stat: 'mineKills' },
    { id: 'survivor',      name: '幸存者',   icon: '🛡️', desc: '存活超过20回合',      goal: 20, stat: 'maxTurnsSurvived' },
    { id: 'veteran',       name: '百场老将', icon: '🎯', desc: '累计完成100局对战',    goal: 100,stat: 'games' },
    { id: 'champion',      name: '冠军',     icon: '🏆', desc: '匹配模式获胜30局',     goal: 30, stat: 'wins' },
    { id: 'streak3',       name: '三连胜',   icon: '🔥', desc: '匹配模式连胜3局',      goal: 3,  stat: 'currentStreak' },
    { id: 'streak7',       name: '势不可挡', icon: '⚡', desc: '匹配模式连胜7局',      goal: 7,  stat: 'currentStreak' },
    { id: 'rich',          name: '富豪',     icon: '💰', desc: '累计获得50🪙',         goal: 50, stat: 'totalCoinsEarned' },
    { id: 'king',          name: '登顶王者', icon: '🌟', desc: '段位达到王者',         goal: 1,  stat: 'reachedKing' },
];

// ==========================================
// 📋 每日任务系统
// ==========================================
const DAILY_TASK_POOL = [
    { id: 'play1',       text: '完成 1 局对战',        reward: 1, check: (ctx) => ctx.gamesPlayed >= 1 },
    { id: 'play3',       text: '完成 3 局对战',        reward: 2, check: (ctx) => ctx.gamesPlayed >= 3 },
    { id: 'win1',        text: '获胜 1 局',            reward: 1, check: (ctx) => ctx.gamesWon >= 1 },
    { id: 'win2',        text: '匹配模式获胜 2 局',    reward: 2, check: (ctx) => ctx.matchWins >= 2 },
    { id: 'kill1',       text: '击杀 1 个敌人',        reward: 1, check: (ctx) => ctx.kills >= 1 },
    { id: 'kill3',       text: '击杀 3 个敌人',        reward: 2, check: (ctx) => ctx.kills >= 3 },
    { id: 'blast1',      text: '使用"轰"击杀 1 次',    reward: 1, check: (ctx) => ctx.blastKills >= 1 },
    { id: 'mine1',       text: '用地雷炸死 1 个敌人',  reward: 1, check: (ctx) => ctx.mineKills >= 1 },
    { id: 'defuse2',     text: '拆除 2 颗地雷',        reward: 1, check: (ctx) => ctx.defuses >= 2 },
    { id: 'blink3',      text: '使用"闪"技能 3 次',    reward: 1, check: (ctx) => ctx.blinks >= 3 },
    { id: 'explore20',   text: '探索 20 个新格子',     reward: 1, check: (ctx) => ctx.cellsExplored >= 20 },
    { id: 'survive10',   text: '在一局中存活 10 回合', reward: 1, check: (ctx) => ctx.maxTurnsInGame >= 10 },
];

function generateDailyTasks() {
    // 随机抽取 3 个不重复的每日任务
    const pool = [...DAILY_TASK_POOL];
    const tasks = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        tasks.push({ ...pool.splice(idx, 1)[0] });
        delete tasks[tasks.length - 1].check; // 不存函数
    }
    return tasks;
}

// ==========================================
// 📅 赛季系统
// ==========================================
const SEASON_CONFIG = {
    durationDays: 30,  // 每个赛季 30 天
    softResetFactor: 0.5, // 新分 = 1000 + 旧分 * 0.5
};

function getCurrentSeason() {
    // 赛季以 2026-01-01 为起点，每 30 天一个赛季
    const epoch = new Date('2026-01-01').getTime();
    const now = Date.now();
    const seasonNum = Math.floor((now - epoch) / (SEASON_CONFIG.durationDays * 24 * 60 * 60 * 1000));
    const seasonStart = epoch + seasonNum * SEASON_CONFIG.durationDays * 24 * 60 * 60 * 1000;
    const seasonEnd = seasonStart + SEASON_CONFIG.durationDays * 24 * 60 * 60 * 1000;
    return {
        number: seasonNum + 1,
        name: `S${seasonNum + 1}`,
        start: seasonStart,
        end: seasonEnd,
        remainingDays: Math.ceil((seasonEnd - now) / (24 * 60 * 60 * 1000)),
    };
}

// ==========================================
// 📊 排行榜
// ==========================================
function getLeaderboard(type, limit = 50) {
    const users = loadUsers();
    const entries = [];
    for (const [username, data] of Object.entries(users)) {
        if (!data.stats) continue;
        let score;
        switch (type) {
            case 'rating':  score = data.rating || 1000; break;
            case 'wins':    score = data.stats.wins || 0; break;
            case 'games':   score = data.stats.games || 0; break;
            case 'coins':   score = data.coins || 0; break;
            default:        score = data.rating || 1000;
        }
        entries.push({ username, score, rating: data.rating || 1000, tier: getTier(data.rating || 1000), wins: data.stats.wins || 0, games: data.stats.games || 0 });
    }
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, limit);
}

// 连胜追踪（当前连胜）
function getCurrentStreak(username) {
    const users = loadUsers();
    return users[username]?.currentStreak || 0;
}

// ==========================================
// 🛒 REST 端点：商店
// ==========================================
app.get('/api/shop/items', (req, res) => {
    const token = req.query.token;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });
    const users = loadUsers();
    const user = users[username];
    const inventory = user?.inventory || [];
    const equipped = user?.equipped || {};
    res.json({ ok: true, items: SHOP_ITEMS, inventory, equipped });
});

app.post('/api/shop/buy', (req, res) => {
    const { token, itemId } = req.body;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });

    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return res.json({ ok: false, msg: '商品不存在' });

    const users = loadUsers();
    const user = users[username];
    if (!user) return res.json({ ok: false, msg: '用户不存在' });

    if ((user.inventory || []).includes(itemId)) return res.json({ ok: false, msg: '已拥有此物品' });
    if ((user.coins || 0) < item.cost) return res.json({ ok: false, msg: `🪙不足，需要 ${item.cost} 币` });

    user.coins -= item.cost;
    if (!user.inventory) user.inventory = [];
    user.inventory.push(itemId);
    saveUsers(users);

    // 通知币数变化
    for (const [id, s] of io.sockets.sockets) {
        if (s.username === username) s.emit('coins_updated', { coins: user.coins });
    }
    res.json({ ok: true, coins: user.coins, inventory: user.inventory });
});

app.post('/api/shop/equip', (req, res) => {
    const { token, itemId } = req.body;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });

    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return res.json({ ok: false, msg: '商品不存在' });

    const users = loadUsers();
    const user = users[username];
    if (!(user.inventory || []).includes(itemId)) return res.json({ ok: false, msg: '未拥有此物品' });

    if (!user.equipped) user.equipped = {};
    // 同类型替换
    user.equipped[item.type] = itemId;
    saveUsers(users);

    // 通知皮肤变更
    for (const [id, s] of io.sockets.sockets) {
        if (s.username === username) s.emit('equip_updated', { equipped: user.equipped });
    }
    res.json({ ok: true, equipped: user.equipped });
});

// ==========================================
// 🎯 REST 端点：成就
// ==========================================
app.get('/api/achievements', (req, res) => {
    const token = req.query.token;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });
    const users = loadUsers();
    const user = users[username];
    const achievements = user?.achievements || {};
    const progress = user?.achievementProgress || {};
    const list = ACHIEVEMENTS.map(a => ({
        ...a,
        unlocked: !!achievements[a.id],
        unlockedAt: achievements[a.id]?.unlockedAt || null,
        progress: Math.min(progress[a.id] || 0, a.goal),
    }));
    res.json({ ok: true, achievements: list });
});

// ==========================================
// 📋 REST 端点：每日任务
// ==========================================
app.get('/api/daily-tasks', (req, res) => {
    const token = req.query.token;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });
    const users = loadUsers();
    const user = users[username];
    const today = new Date().toISOString().split('T')[0];

    // 如果任务日期不是今天，生成新任务
    if (!user.dailyTasks || user.dailyTasks.date !== today) {
        user.dailyTasks = { date: today, tasks: generateDailyTasks(), progress: [0, 0, 0], claimed: [false, false, false] };
        saveUsers(users);
    }
    res.json({ ok: true, tasks: user.dailyTasks.tasks, progress: user.dailyTasks.progress, claimed: user.dailyTasks.claimed, date: today });
});

app.post('/api/claim-task', (req, res) => {
    const { token, taskIndex } = req.body;
    const username = TOKENS.get(token);
    if (!username) return res.json({ ok: false, msg: '未登录' });
    const users = loadUsers();
    const user = users[username];
    if (!user.dailyTasks) return res.json({ ok: false, msg: '无任务' });

    const idx = parseInt(taskIndex);
    if (isNaN(idx) || idx < 0 || idx >= 3) return res.json({ ok: false, msg: '无效任务' });
    if (user.dailyTasks.claimed[idx]) return res.json({ ok: false, msg: '已领取' });
    if (!user.dailyTasks.progress[idx] || user.dailyTasks.progress[idx] < user.dailyTasks.tasks[idx].reward) return res.json({ ok: false, msg: '任务未完成' });

    user.dailyTasks.claimed[idx] = true;
    const reward = user.dailyTasks.tasks[idx].reward;
    user.coins = (user.coins || 0) + reward;
    saveUsers(users);

    for (const [id, s] of io.sockets.sockets) {
        if (s.username === username) s.emit('coins_updated', { coins: user.coins });
    }
    res.json({ ok: true, coins: user.coins, reward });
});

// ==========================================
// 📊 REST 端点：排行榜
// ==========================================
app.get('/api/leaderboard', (req, res) => {
    const type = req.query.type || 'rating';
    const lb = getLeaderboard(type);
    res.json({ ok: true, leaderboard: lb, season: getCurrentSeason() });
});

// ==========================================
// 📅 REST 端点：赛季信息
// ==========================================
app.get('/api/season', (req, res) => {
    res.json(getCurrentSeason());
});

// ==========================================
// 工具函数：更新成就进度、每日任务进度
// ==========================================
function updateAchievementProgress(username, statKey, delta) {
    const users = loadUsers();
    const user = users[username];
    if (!user) return;
    if (!user.achievementProgress) user.achievementProgress = {};
    if (!user.achievements) user.achievements = {};
    user.achievementProgress[statKey] = (user.achievementProgress[statKey] || 0) + delta;

    // 检查成就解锁
    const newlyUnlocked = [];
    for (const ach of ACHIEVEMENTS) {
        if (ach.stat === statKey && !user.achievements[ach.id]) {
            const prog = user.achievementProgress[statKey] || 0;
            if (prog >= ach.goal) {
                user.achievements[ach.id] = { unlockedAt: Date.now() };
                newlyUnlocked.push(ach);
            }
        }
    }
    saveUsers(users);

    // 通知成就解锁
    if (newlyUnlocked.length > 0) {
        for (const [id, s] of io.sockets.sockets) {
            if (s.username === username) {
                s.emit('achievement_unlocked', { achievements: newlyUnlocked });
            }
        }
    }
}

function updateDailyTaskProgress(username, ctx) {
    const users = loadUsers();
    const user = users[username];
    if (!user || !user.dailyTasks) return;
    const today = new Date().toISOString().split('T')[0];
    if (user.dailyTasks.date !== today) return;

    for (let i = 0; i < 3; i++) {
        if (user.dailyTasks.claimed[i]) continue;
        const task = user.dailyTasks.tasks[i];
        const def = DAILY_TASK_POOL.find(t => t.id === task.id);
        if (def && def.check(ctx)) {
            user.dailyTasks.progress[i] = task.reward; // 标记完成（reward=完成标记）
            if (!user.dailyTasks.claimed[i] && user.dailyTasks.progress[i] >= task.reward) {
                // 推送到客户端
            }
        }
    }
    saveUsers(users);

    // 通知任务进度更新
    for (const [id, s] of io.sockets.sockets) {
        if (s.username === username) {
            s.emit('tasks_updated', { tasks: user.dailyTasks.tasks, progress: user.dailyTasks.progress, claimed: user.dailyTasks.claimed });
        }
    }
}

// ── Socket.IO 认证中间件 ──
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('未登录'));
    const username = TOKENS.get(token);
    if (!username) return next(new Error('登录已过期，请重新登录'));
    socket.username = username;
    next();
});

// ==========================================
// 1. 全局数据结构与配置
// ==========================================
// 四人局角色与颜色配置映射 (1-indexed 完美对齐前端)
const PLAYER_CONFIGS = {
    1: { roleId: 1, color: '#b71c1c', name: '红方' },
    2: { roleId: 2, color: '#0d47a1', name: '蓝方' },
    3: { roleId: 3, color: '#1b5e20', name: '绿方' },
    4: { roleId: 4, color: '#f57f17', name: '黄方' }
};

const rooms = {};              // 存放所有自定义房间和匹配房间

// ================= 🌟 新增：初始化固定测试房间 000000 =================
rooms['000000'] = {
    maxPlayers: 2,
    slotTypes: [2, 2, 0, 0],
    activeRoleIds: [1, 2],
    mapN: 10,
    gameStarted: true,
    gridData: generateRealMap(10),
    players: [
        { id: 'AI_000000_1', roleId: 1, color: PLAYER_CONFIGS[1].color, name: PLAYER_CONFIGS[1].name + '(AI)', alive: true, isAI: true, votedRemap: false, votedRerp: false },
        { id: 'AI_000000_2', roleId: 2, color: PLAYER_CONFIGS[2].color, name: PLAYER_CONFIGS[2].name + '(AI)', alive: true, isAI: true, votedRemap: false, votedRerp: false }
    ],
    spectators: [],     // 存放该房间内的旁观者 socket.id
    aiHostId: null,     // 当前指定代跑 AI 逻辑的旁观者 id
    lastGameState: null
};
// ===================================================================

// 匹配模式队列：存放 { socketId, username, rating, joinedAt }
let matchmakingQueue = [];
let globalOnlineCount = 0; // 新增：全局实时在线人数计数器

const MATCH_RATING_WINDOW_BASE = 200;    // 基础段位差窗口
const MATCH_RATING_WINDOW_GROWTH = 30;   // 每秒扩大 30 分
const MATCH_MAX_WINDOW = 2000;           // 窗口上限（基本等于来者不拒）

const MAP_SIZE_DEFAULT = 10;

// ==========================================
// 2. 核心辅助工具函数（防卡死与真地图生成）
// ==========================================

// 真正的地图生成器：确保生成前端所需的所有属性，杜绝任何 undefined 导致的白屏
// 真正的地图生成器：通过数字池洗牌，保证绝对唯一、绝对不卡死、全员 3 位数
// terrainWeights: { white, gray, blue, green } 可选，不传则默认 3:1:1:1
function generateRealMap(N, terrainWeights) {
    // 安全熔断：如果外部传入的 N 导致格子数超过了 900 个（比如 N >= 30），强制截断到 29
    // 确保绝对不会发生数组越界或取到 undefined 的情况
    if (N > 30) N = 30;

    const grid = [];

    // 构建加权地形选择器
    let pickTerrain;
    if (terrainWeights) {
        const total = (terrainWeights.white || 0) + (terrainWeights.gray || 0) +
                      (terrainWeights.blue || 0) + (terrainWeights.green || 0);
        if (total > 0) {
            const cw = [
                terrainWeights.white / total,
                (terrainWeights.white + terrainWeights.gray) / total,
                (terrainWeights.white + terrainWeights.gray + terrainWeights.blue) / total
            ];
            pickTerrain = () => {
                const r = Math.random();
                if (r < cw[0]) return 'white';
                if (r < cw[1]) return 'gray';
                if (r < cw[2]) return 'blue';
                return 'green';
            };
        }
    }
    if (!pickTerrain) {
        const defaultTerrains = ['white', 'white', 'white', 'gray', 'blue', 'green'];
        pickTerrain = () => defaultTerrains[Math.floor(Math.random() * defaultTerrains.length)];
    }
    
    // 1. 初始化 100 到 999 的完整 3 位数池子（共 900 个唯一数字）
    const numPool = [];
    for (let i = 100; i <= 999; i++) {
        numPool.push(i);
    }

    // 2. 局部洗牌算法（Fisher-Yates）：只随机打乱我们需要用到的前 N * N 个位置
    const totalCells = N * N;
    for (let i = 0; i < totalCells; i++) {
        // 从当前位置到池子末尾之间随机挑一个下标
        const randIndex = Math.floor(Math.random() * (numPool.length - i)) + i;
        // 交换当前元素与随机元素的位置
        const temp = numPool[i];
        numPool[i] = numPool[randIndex];
        numPool[randIndex] = temp;
    }

    // 3. 顺序取出已经打乱的唯一数字填入地图
    let poolIndex = 0;
    for (let r = 0; r < N; r++) {
        const row = [];
        for (let c = 0; c < N; c++) {
            const terrainType = pickTerrain();
            const cellNum = numPool[poolIndex++]; // 绝对唯一的 3 位数

            row.push({
                type: terrainType,
                num: cellNum,
                rewardUsed: false,
                // 预留玩家埋雷状态
                mineP1: false, mineP2: false, mineP3: false, mineP4: false
            });
        }
        grid.push(row);
    }
    return grid;
}

// 创建一个干净的房间对象
function createRoomObject(slots, mapSize = MAP_SIZE_DEFAULT, terrainWeights = null) {
    const maxPlayers = slots.filter(s => s !== 0).length;
    return {
        maxPlayers: maxPlayers,
        humanSlotCount: slots.filter(s => s === 1).length,  // 🔧 真人槽位数量（用于显示和开局判定）
        slotTypes: [...slots],       // 四个槽位的类型：0=空, 1=玩家, 2=AI
        activeRoleIds: slots.map((s, i) => s !== 0 ? i + 1 : null).filter(Boolean), // 非空槽对应的 roleId
        mapN: mapSize,
        terrainWeights: terrainWeights,  // 🌟 地形分布权重（null = 默认 3:1:1:1）
        gameStarted: false,
        gridData: null,
        players: new Array(4).fill(null)  // 始终4格，空槽对应 null
    };
}

// 检查并处理投票（重开地图 / 随机出生）
function processVote(room, roomId, type) {
    let allVoted = true;
    let humanCount = 0;

    // 1. 统计投票（只看参与的真人）
    room.players.forEach(p => {
        if (p && !p.isAI) {
            humanCount++;
            let voteProp = type === 'remap' ? 'votedRemap' : 'votedRerp';
            if (!p[voteProp]) {
                allVoted = false;
            }
        }
    });

    // 2. 同步灯光状态给前端
    let voteStatus = room.players.map(p => p ? p[type === 'remap' ? 'votedRemap' : 'votedRerp'] : false);
    io.to(roomId).emit('vote_status_update', { type: type, voteStatus: voteStatus });

    // 3. 只有当房间内有真人，且所有真人均已投票时，才执行重置
    if (humanCount > 0 && allVoted) {
        // 清理所有人（包括 AI）的投票状态
        room.players.forEach(p => {
            if (p) { p.votedRemap = false; p.votedRerp = false; }
        });
        io.to(roomId).emit('clear_votes');

        if (type === 'remap') {
            room.gridData = generateRealMap(room.mapN, room.terrainWeights);
            // 🌟【核心修复点 1】：后端内存同步将所有在线玩家（含 AI）的 alive 状态恢复为 true！
            // 确保重开后的新对局中，后端不再卡死他们的生命状态
            room.players.forEach(p => { if (p) p.alive = true; });

            io.to(roomId).emit('map_regenerated', { gridData: room.gridData });
        } else if (type === 'rerp') {
            // 🌟 安全过滤出可出生单元格（严格限制为非水路、非高山的白地）
            let safeCells = []; 
            for(let r=0; r<room.mapN; r++){
                for(let c=0; c<room.mapN; c++){
                    if(room.gridData && room.gridData[r][c].type === 'white') {
                        safeCells.push({r, c});
                    }
                }
            }
            if(safeCells.length < room.maxPlayers) {
                safeCells = [{r:0,c:0}, {r:0,c:1}, {r:1,c:0}, {r:1,c:1}];
            }

            let updates = {};
            room.players.forEach((p, idx) => {
                // 🌟【核心修复】：去掉 p.alive 限制，不管上一局输赢死活，只要玩家/AI在线就处理
                if (p) {
                    // 🌟 强制在后端内存中复活玩家，彻底清除胜负影响
                    p.alive = true; 
                    let randIdx = Math.floor(Math.random() * safeCells.length);
                    let cell = safeCells.splice(randIdx, 1)[0];
                    updates[idx + 1] = { r: cell.r, c: cell.c };
                }
            });
            // 精准匹配前端更新格式
            io.to(roomId).emit('positions_randomized', { updates: updates });
        }
    }
}

// 新增：广播匹配队列状态（含候选段位范围）
function broadcastMatchStatus() {
    let ratingRange = null;
    if (matchmakingQueue.length > 0) {
        const ratings = matchmakingQueue.map(e => e.rating).filter(r => r != null);
        if (ratings.length > 0) {
            ratingRange = { min: Math.min(...ratings), max: Math.max(...ratings) };
        }
    }
    io.emit('matchmaking_status', { count: matchmakingQueue.length, ratingRange });
}

// ==========================================
// 3. Socket 联机事件监听
// ==========================================
io.on('connection', (socket) => {
    // 新增：玩家连接，在线人数+1并全服广播
    globalOnlineCount++;
    // 新上线玩家立刻获取当前匹配队列状态
    socket.emit('matchmaking_status', { count: matchmakingQueue.length });
    io.emit('server_online_count', { count: globalOnlineCount });
    
    // ---- 功能 1：匹配模式 (段位相近优先匹配) ----
    socket.on('join_matchmaking', () => {
        // 读取当前段位分
        const users = loadUsers();
        const user = users[socket.username];
        const myRating = user ? (user.rating || 1000) : 1000;

        // 避免重复加入
        if (matchmakingQueue.some(e => e.socketId === socket.id)) {
            broadcastMatchStatus();
            return;
        }
        matchmakingQueue.push({ socketId: socket.id, username: socket.username, rating: myRating, joinedAt: Date.now() });

        // 尝试匹配：找段位分最接近的对手
        if (matchmakingQueue.length >= 2) {
            const now = Date.now();
            // 计算当前队列中每个人的等待时间（秒）
            const waitSeconds = (entry) => (now - entry.joinedAt) / 1000;

            let bestPair = null;
            let bestDiff = Infinity;

            // 找最佳匹配对（评估所有配对，优先选段位差最小的）
            for (let i = 0; i < matchmakingQueue.length; i++) {
                for (let j = i + 1; j < matchmakingQueue.length; j++) {
                    const a = matchmakingQueue[i], b = matchmakingQueue[j];
                    const diff = Math.abs(a.rating - b.rating);
                    // 动态窗口：等待越久，允许的段位差越大
                    const maxWait = Math.max(waitSeconds(a), waitSeconds(b));
                    const window = Math.min(MATCH_RATING_WINDOW_BASE + maxWait * MATCH_RATING_WINDOW_GROWTH, MATCH_MAX_WINDOW);
                    if (diff <= window && diff < bestDiff) {
                        bestDiff = diff;
                        bestPair = [i, j];
                    }
                }
            }

            if (bestPair) {
                // 从队列中移除（先移除索引大的避免偏移问题）
                const [i1, i2] = bestPair;
                const p1 = matchmakingQueue[i2]; // 先取大的
                const p2 = matchmakingQueue[i1];
                matchmakingQueue.splice(i2, 1);
                matchmakingQueue.splice(i1, 1);

                const p1Id = p1.socketId, p2Id = p2.socketId;
                let roomId = 'MATCH_' + Math.random().toString(36).substr(2, 6).toUpperCase();
                let room = createRoomObject([1, 1, 0, 0], 10);
                room.isMatchRoom = true;  // ★ 标记为匹配房
                room.p1Username = p1.username;
                room.p2Username = p2.username;
                rooms[roomId] = room;

                const s1 = io.sockets.sockets.get(p1Id);
                const s2 = io.sockets.sockets.get(p2Id);

                room.players[0] = { id: p1Id, roleId: 1, color: PLAYER_CONFIGS[1].color, name: p1.username, alive: true, votedRemap: false, votedRerp: false };
                room.players[1] = { id: p2Id, roleId: 2, color: PLAYER_CONFIGS[2].color, name: p2.username, alive: true, votedRemap: false, votedRerp: false };

                room.gridData = generateRealMap(10);
                room.gameStarted = true;
                if(s1) { s1.roomId = roomId; s1.join(roomId); }
                if(s2) { s2.roomId = roomId; s2.join(roomId); }

                // 附带段位信息到 game_start
                const configs = {
                    1: { name: room.players[0].name, color: room.players[0].color, rating: p1.rating, tier: getTier(p1.rating) },
                    2: { name: room.players[1].name, color: room.players[1].color, rating: p2.rating, tier: getTier(p2.rating) }
                };

                io.to(p1Id).emit('game_start', { roomId, myRoleId: 1, maxPlayers: 2, slotTypes: room.slotTypes, activeRoleIds: room.activeRoleIds, configs, gridData: room.gridData });
                io.to(p2Id).emit('game_start', { roomId, myRoleId: 2, maxPlayers: 2, slotTypes: room.slotTypes, activeRoleIds: room.activeRoleIds, configs, gridData: room.gridData });

                broadcastMatchStatus();
            } else {
                broadcastMatchStatus();
            }
        } else {
            broadcastMatchStatus();
        }
    });

    // ---- 取消匹配 ----
    socket.on('leave_matchmaking', () => {
        const oldLen = matchmakingQueue.length;
        matchmakingQueue = matchmakingQueue.filter(e => e.socketId !== socket.id);
        if (oldLen !== matchmakingQueue.length) {
            broadcastMatchStatus();
        }
    });

    // ---- 功能 2：创建自定义房间（支持槽位设定） ----
    socket.on('create_room', (data) => {
        const slots = (data.slots && Array.isArray(data.slots) && data.slots.length === 4)
            ? data.slots : [1, 1, 0, 0];
        let mapSize = parseInt(data.mapSize) || 10;

        // 🌟 提取地形权重（可选，后端兼容旧客户端不传的情况）
        let terrainWeights = null;
        if (data.terrainWeights) {
            const tw = data.terrainWeights;
            const total = (tw.white || 0) + (tw.gray || 0) + (tw.blue || 0) + (tw.green || 0);
            if (total > 0) terrainWeights = { white: tw.white, gray: tw.gray, blue: tw.blue, green: tw.green };
        }

        let roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
        let room = createRoomObject(slots, mapSize, terrainWeights);

        // 🌟 根据槽位状态：AI 填入指定位置
        for (let i = 0; i < 4; i++) {
            if (slots[i] === 2) {
                let currentRoleId = i + 1;
                let cfg = PLAYER_CONFIGS[currentRoleId];
                room.players[i] = {
                    id: 'AI_' + roomId + '_' + currentRoleId,
                    roleId: currentRoleId,
                    color: cfg.color,
                    name: cfg.name + '(AI)',
                    alive: true, r: -1, c: -1, sp: 15, mud: 0,
                    isAI: true,
                    votedRemap: false,
                    votedRerp: false
                };
            }
        }

        const aiCount = slots.filter(s => s === 2).length;
        const nonEmptyCount = slots.filter(s => s !== 0).length;

        // 🔧 全 AI 房间：生成地图并激活，但出生交给前端 AI 引擎逐回合决策（不再服务端代劳，确保日志完整）
        if (aiCount === nonEmptyCount && nonEmptyCount > 0) {
            room.gridData = generateRealMap(room.mapN, room.terrainWeights);
            room.currentPlayer = 1;
            room.gameStarted = true;
        }


        rooms[roomId] = room;
        socket.emit('room_created', {
            roomId: roomId,
            maxPlayers: room.maxPlayers,
            slotTypes: room.slotTypes,
            activeRoleIds: room.activeRoleIds
        });
    });

    // ---- 功能 3：动态加入自定义房间 ----
    socket.on('join_room', (data) => {
        let roomId = data.roomId;
        if (!rooms[roomId]) {
            socket.emit('join_error', '房间不存在！');
            return;
        }

        let room = rooms[roomId];
        
        // 🌟 按槽位类型找第一个玩家待填的空位
        let emptySlotIndex = -1;
        for (let i = 0; i < 4; i++) {
            if (room.slotTypes[i] === 1 && !room.players[i]) {
                emptySlotIndex = i;
                break;
            }
        }
            if (emptySlotIndex === -1) {
            // 🌟 修改：如果房间满人且游戏已经开始，则让新加入的人自动成为旁观者
            if (room.gameStarted) {
                socket.roomId = roomId;
                socket.join(roomId);
                
                // 🌟 新增：维护旁观者列表，并指定首个加入的旁观者为 AI 宿主
                if (!room.spectators) room.spectators = [];
                room.spectators.push(socket.id);
                // 🌟 修改：如果是 000000 测试房，或者本房间全都是 AI 选手（无真人槽），将进来的第一个真人（创建者）设为宿主
                const hasNoHumanSlots = !room.slotTypes || !room.slotTypes.some(s => s === 1);
                if ((hasNoHumanSlots || roomId === '000000') && !room.aiHostId) {
                    room.aiHostId = socket.id;
                }
                
                // 提取当前对局的所有已有玩家/AI的配置包
                const globalConfigs = {};
                const playerSnapshots = {};
                room.players.forEach((p, idx) => {
                    if (p) {
                        globalConfigs[idx + 1] = { name: p.name, color: p.color, isAI: p.isAI || false };
                        playerSnapshots[idx + 1] = { r: p.r, c: p.c, sp: p.sp, mud: p.mud, alive: p.alive, isAI: p.isAI || false };
                    }
                });

                // 向该连接独立投递旁观者开局包，并附带最新的实时游戏数据缓存
                socket.emit('spectator_start', {
                    roomId: roomId,
                    maxPlayers: room.maxPlayers,
                    slotTypes: room.slotTypes,
                    activeRoleIds: room.activeRoleIds,
                    currentPlayer: room.currentPlayer,
                    configs: globalConfigs,
                    players: playerSnapshots,
                    gridData: room.gridData,
                    gameState: room.lastGameState,
                    isAIHost: (room.aiHostId === socket.id)
                });
                return;
            } else {
                socket.emit('join_error', '出现错误！');
                return;
            }
        }
        

        let currentRoleId = emptySlotIndex + 1;
        let cfg = PLAYER_CONFIGS[currentRoleId];

        room.players[emptySlotIndex] = {
            id: socket.id,
            roleId: currentRoleId,
            color: cfg.color,
            name: socket.username,  // 使用登录用户名
            alive: true,
            isAI: false,
            votedRemap: false,
            votedRerp: false
        };

        socket.roomId = roomId;
        socket.join(roomId);

        // 🔧 只统计真人，AI 不计入等待数和分母
        let humanCount = room.players.filter(p => p !== null && !p.isAI).length;

        io.to(roomId).emit('room_state_update', {
            roomId: roomId,
            joinedCount: humanCount,
            maxPlayers: room.humanSlotCount,
            slotTypes: room.slotTypes,
            activeRoleIds: room.activeRoleIds
        });

        // 真人到齐即可开局（AI 已预填）
        if (humanCount === room.humanSlotCount) {
            room.gridData = generateRealMap(room.mapN, room.terrainWeights);            room.gameStarted = true;

            const globalConfigs = {};
            room.players.forEach((p, idx) => {
                if (p) globalConfigs[idx + 1] = { name: p.name, color: p.color, isAI: p.isAI || false };
            });

            room.players.forEach((p, idx) => {
                // 如果是真人玩家，投递开局包
                if (p && !p.isAI) {
                    io.to(p.id).emit('game_start', {
                        roomId: roomId,
                        myRoleId: idx + 1,
                        maxPlayers: room.maxPlayers,
                        slotTypes: room.slotTypes,
                        activeRoleIds: room.activeRoleIds,
                        configs: globalConfigs,
                        gridData: room.gridData
                    });
                }
            });
        }
    });
    // ---- 🌟 核心新增功能：前后端状态同步数据立交桥 🌟 ----
    // 负责接收某一个玩家计算出的最新状态，高可靠性广播分发给本局的所有在线玩家
    socket.on('sync_state', (data) => {
        if (data && data.roomId && rooms[data.roomId]) {
            const room = rooms[data.roomId];
            room.lastGameState = data.gameState;
            // 🔧 同步回合指针，确保新加入的旁观者看到当前是谁的回合
            if (data.gameState && data.gameState.currentPlayer) {
                room.currentPlayer = data.gameState.currentPlayer;
            }
            // 同步生存状态至后端内存，防止因信息断层引发意外的无限循环
            if (data.gameState && data.gameState.players) {
                for (const roleId of room.activeRoleIds) {
                    if (data.gameState.players[roleId] && room.players[roleId - 1]) {
                        room.players[roleId - 1].alive = data.gameState.players[roleId].alive;
                    }
                }
            }
            // 扩散同步广播
            io.to(data.roomId).emit('state_updated', data.gameState);
        }
    });

    // ---- 🪙🏆 对局结束结算 ----
    socket.on('report_game_end', (data) => {
        const roomId = data.roomId || socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // 防止同一房间重复结算
        if (room._settled) return;
        room._settled = true;

        // 找出本局中所有真人玩家
        const humanPlayers = room.players.filter(p => p && !p.isAI);
        const humanUsernames = humanPlayers.map(p => {
            const s = io.sockets.sockets.get(p.id);
            return s ? s.username : null;
        }).filter(Boolean);

        // 🪙 所有真人：完成一局 +1 coin
        for (const uname of humanUsernames) {
            awardCoins(uname, 1);
            // 🎯 成就追踪：总币数、总局数
            const users2 = loadUsers();
            const u = users2[uname];
            if (u) {
                u.stats.totalCoinsEarned = (u.stats.totalCoinsEarned || 0) + 1;
                saveUsers(users2);
            }
            updateAchievementProgress(uname, 'games', 1);
            updateAchievementProgress(uname, 'totalCoinsEarned', 1);
        }

        // 📋 每日任务追踪
        const taskCtx = { gamesPlayed: 1, gamesWon: 0, kills: data.kills || 0, blastKills: data.blastKills || 0, mineKills: data.mineKills || 0, defuses: data.defuses || 0, blinks: data.blinks || 0, cellsExplored: data.cellsExplored || 0, maxTurnsInGame: data.maxTurnsInGame || 0, matchWins: 0 };
        for (const uname of humanUsernames) {
            updateDailyTaskProgress(uname, taskCtx);
        }

        // 🎯 对战数据成就追踪
        for (const uname of humanUsernames) {
            if (data.kills) updateAchievementProgress(uname, 'kills', data.kills);
            if (data.stompKills) updateAchievementProgress(uname, 'stompKills', data.stompKills);
            if (data.blastKills) updateAchievementProgress(uname, 'blastKills', data.blastKills);
            if (data.mineKills) updateAchievementProgress(uname, 'mineKills', data.mineKills);
            if (data.defuses) updateAchievementProgress(uname, 'defuses', data.defuses);
            if (data.maxTurnsInGame) updateAchievementProgress(uname, 'maxTurnsSurvived', data.maxTurnsInGame);
        }

        // 🏆 匹配房才结算段位
        if (room.isMatchRoom && humanPlayers.length === 2) {
            const users = loadUsers();
            const p1 = humanPlayers[0], p2 = humanPlayers[1];
            const s1 = io.sockets.sockets.get(p1.id);
            const s2 = io.sockets.sockets.get(p2.id);
            const u1 = s1 ? s1.username : null;
            const u2 = s2 ? s2.username : null;
            if (!u1 || !u2) return;

            const r1 = (users[u1] && users[u1].rating) || 1000;
            const r2 = (users[u2] && users[u2].rating) || 1000;

            // 根据客户端上报的 winnerRoleId 判断胜负
            const p1Won = (data.winnerRoleId === p1.roleId);
            const { newA, newB } = calcNewRatings(r1, r2, p1Won);

            // 更新统计
            if (users[u1]) {
                users[u1].stats.games = (users[u1].stats.games || 0) + 1;
                if (p1Won) {
                    users[u1].stats.wins++;
                    users[u1].currentStreak = (users[u1].currentStreak || 0) + 1;
                    if (users[u1].currentStreak > (users[u1].bestStreak || 0)) users[u1].bestStreak = users[u1].currentStreak;
                    awardCoins(u1, 3);
                } else {
                    users[u1].stats.losses++;
                    users[u1].currentStreak = 0;
                }
            }
            if (users[u2]) {
                users[u2].stats.games = (users[u2].stats.games || 0) + 1;
                if (!p1Won) {
                    users[u2].stats.wins++;
                    users[u2].currentStreak = (users[u2].currentStreak || 0) + 1;
                    if (users[u2].currentStreak > (users[u2].bestStreak || 0)) users[u2].bestStreak = users[u2].currentStreak;
                    awardCoins(u2, 3);
                } else {
                    users[u2].stats.losses++;
                    users[u2].currentStreak = 0;
                }
            }

            // 🎯 成就：连胜、胜场、登顶王者
            if (p1Won) {
                updateAchievementProgress(u1, 'wins', 1);
                updateAchievementProgress(u1, 'currentStreak', users[u1].currentStreak || 0);
            } else {
                updateAchievementProgress(u2, 'wins', 1);
                updateAchievementProgress(u2, 'currentStreak', users[u2].currentStreak || 0);
            }
            if ((users[u1].rating || 1000) >= 1900) updateAchievementProgress(u1, 'reachedKing', 1);
            if ((users[u2].rating || 1000) >= 1900) updateAchievementProgress(u2, 'reachedKing', 1);

            // 📋 每日任务：匹配胜场
            const winCtx = { gamesPlayed: 1, gamesWon: 0, kills: 0, blastKills: 0, mineKills: 0, defuses: 0, blinks: 0, cellsExplored: 0, maxTurnsInGame: 0, matchWins: 1 };
            if (p1Won) updateDailyTaskProgress(u1, winCtx);
            else updateDailyTaskProgress(u2, winCtx);

            saveUsers(users);
            awardRating(u1, newA);
            awardRating(u2, newB);

            // 通知双方段位变化
            for (const [id, s] of io.sockets.sockets) {
                if (s.username === u1 || s.username === u2) {
                    s.emit('match_result', {
                        winner: p1Won ? p1.roleId : p2.roleId,
                        yourNewRating: s.username === u1 ? newA : newB,
                        yourOldRating: s.username === u1 ? r1 : r2,
                        ratingChange: s.username === u1 ? (newA - r1) : (newB - r2)
                    });
                }
            }
        }

        // 通知前端结算完成
        io.to(roomId).emit('settlement_complete', {});
    });

    // ---- 功能 4 & 5：投票重开 / 随机出生 ----
    socket.on('cast_vote', (data) => {
        let roomId = socket.roomId || data.roomId;
        if (!roomId || !rooms[roomId]) return;

        let room = rooms[roomId];
        let player = room.players.find(p => p && p.id === socket.id);

        if (player) {
            let type = data.type;
            let voteProp = type === 'remap' ? 'votedRemap' : 'votedRerp';
            player[voteProp] = !player[voteProp];
            processVote(room, roomId, type);
        }
        // 如果投票者没有实体身份，但它是该全 AI 房间的创建者/代跑宿主，则单方面强制重置
        else if (room.aiHostId === socket.id && (!room.slotTypes || !room.slotTypes.some(s => s === 1))) {
            executeInstantReset(room, roomId, data.type);
        }
    });

    // ---- 功能 6：断线彻底人间蒸发机制 ----
    socket.on('disconnect', () => {
        
        // 新增：玩家断线，在线人数-1并全服广播
        globalOnlineCount = Math.max(0, globalOnlineCount - 1);
        io.emit('server_online_count', { count: globalOnlineCount });
        
        const oldLen = matchmakingQueue.length;
        matchmakingQueue = matchmakingQueue.filter(e => e.socketId !== socket.id);
        if (oldLen !== matchmakingQueue.length) {
            broadcastMatchStatus();
        }

        let roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            let room = rooms[roomId];
            
            // 🌟 新增：从旁观者列表中移除，若断开的是 AI 宿主，则交接给下一位旁观者
            if (room.spectators) {
                room.spectators = room.spectators.filter(id => id !== socket.id);
            }
            const hasNoHumanSlots = !room.slotTypes || !room.slotTypes.some(s => s === 1);
            if ((roomId === '000000' || hasNoHumanSlots) && room.aiHostId === socket.id) {
                room.aiHostId = room.spectators.length > 0 ? room.spectators[0] : null;
                if (room.aiHostId) {
                    // 通知下一位无缝接管
                    io.to(room.aiHostId).emit('assign_ai_host', { isAIHost: true });
                }
            }
            
            let playerIndex = room.players.findIndex(p => p && p.id === socket.id);
            
            if (playerIndex !== -1) {
                let player = room.players[playerIndex];
                
                if (room.gameStarted) {
                    player.alive = false; 
                    // 🌟 核心对齐：以数字形式的 roleId 触发蒸发，移交控制权给前端防卡死防御机制
                    io.to(roomId).emit('player_evaporated', { roleId: playerIndex + 1 });
                } else {
                    room.players[playerIndex] = null;
                    let humanCount = room.players.filter(p => p !== null && !p.isAI).length;
                    io.to(roomId).emit('room_state_update', {
                        roomId: roomId,
                        joinedCount: humanCount,
                        maxPlayers: room.humanSlotCount,
                        slotTypes: room.slotTypes,
                        activeRoleIds: room.activeRoleIds
                    });
                }
            }

            let totalLeft = room.players.filter(p => p !== null && p.alive).length;
            if (totalLeft === 0) { delete rooms[roomId]; }
        }
    });
});

// 🌟 新增：无需多方投票，由创建者/宿主一键单方面重置战局的函数
// 🌟 修复后的单方面重置战局工具函数
function executeInstantReset(room, roomId, type) {
    io.to(roomId).emit('clear_votes');
    room.lastGameState = null; // 清空老的状态缓存
    
    if (type === 'remap') {
        room.gridData = generateRealMap(room.mapN, room.terrainWeights);
        room.players.forEach(p => { if (p) { p.alive = true; p.r = -1; p.c = -1; } });
        io.to(roomId).emit('map_regenerated', { gridData: room.gridData });
        
        // 🔧 全 AI 房间：map_regenerated 已把所有人 r=-1，前端 host 会驱 AI 逐回合 spawn → 无需再 auto-rerp
        // （之前 auto-rerp 是变通方案，现在 AI 可自主 spawn 了）
    } else if (type === 'rerp') {
        const isAllAI = !room.slotTypes || !room.slotTypes.some(s => s === 1);

        if (isAllAI) {
            // 🔧 全 AI 房间：不代劳分配出生，前端 host 会驱 AI 逐回合 spawn
            room.players.forEach(p => {
                if (p) { p.alive = true; p.r = -1; p.c = -1; }
            });
            room.currentPlayer = 1;
            io.to(roomId).emit('positions_randomized', { updates: {} });
        } else {
            let safeCells = [];
            for(let r=0; r<room.mapN; r++) {
                for(let c=0; c<room.mapN; c++) {
                    if(room.gridData && room.gridData[r][c].type === 'white') safeCells.push({r, c});
                }
            }
            if(safeCells.length < room.maxPlayers) safeCells = [{r:0,c:0}, {r:0,c:1}, {r:1,c:0}, {r:1,c:1}];

            let updates = {};
            room.players.forEach((p, idx) => {
                if (p) {
                    p.alive = true;
                    let randIdx = Math.floor(Math.random() * safeCells.length);
                    let cell = safeCells.splice(randIdx, 1)[0];
                    p.r = cell.r;
                    p.c = cell.c;
                    updates[idx + 1] = { r: cell.r, c: cell.c };
                }
            });
            io.to(roomId).emit('positions_randomized', { updates: updates });
            room.currentPlayer = 1;
            io.to(roomId).emit('turn_update', { currentPlayer: 1 });
        }
    }
}

// 监听端口
http.listen(3000, () => {
    console.log('Server is running on port 3000');
});
