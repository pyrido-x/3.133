const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// 开启静态资源托管，确保前端资源正常加载
app.use(express.static(__dirname));

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

let matchmakingQueue = [];     // 匹配模式队列（存放 socket.id）
let globalOnlineCount = 0; // 新增：全局实时在线人数计数器

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

// 新增：广播匹配队列状态
function broadcastMatchStatus() {
    io.emit('matchmaking_status', { count: matchmakingQueue.length });
}

// ══════════════════════════════════════
//  🔒 同一账号只能一个连接：token → socket 映射表
// ══════════════════════════════════════
const tokenSockets = {}; // token → socket.id

// ==========================================
// 3. Socket 联机事件监听
// ==========================================
io.on('connection', (socket) => {
    // 🌟 注册认证 token（同一账号旧连接被踢）
    socket.on('register_auth', (data) => {
        const token = (data && data.token) || '';
        if (token) {
            // 检查是否有同 token 的旧连接
            const oldSocketId = tokenSockets[token];
            if (oldSocketId && oldSocketId !== socket.id) {
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket) {
                    oldSocket.emit('kicked', { reason: '你的账号在其他设备登录，此连接已断开' });
                    oldSocket.disconnect(true);
                }
            }
            tokenSockets[token] = socket.id;
            socket._authToken = token;
        } else {
            // 清除旧 token 关联
            if (socket._authToken) delete tokenSockets[socket._authToken];
            socket._authToken = null;
        }
    });

    // 新增：玩家连接，在线人数+1并全服广播
    globalOnlineCount++;
    // 新上线玩家立刻获取当前匹配队列状态
    socket.emit('matchmaking_status', { count: matchmakingQueue.length });
    io.emit('server_online_count', { count: globalOnlineCount });
    
    // ---- 功能 1：匹配模式 (双人对战快速开局) ----
    socket.on('join_matchmaking', (data) => {
        // 🌟 存储昵称
        if (data && data.nickname) socket._nickname = data.nickname;

        if (!matchmakingQueue.includes(socket.id)) {
            matchmakingQueue.push(socket.id);
        }

        if (matchmakingQueue.length >= 2) {
            let p1Id = matchmakingQueue.shift();
            let p2Id = matchmakingQueue.shift();

            let roomId = 'MATCH_' + Math.random().toString(36).substr(2, 6).toUpperCase();
            let room = createRoomObject([1, 1, 0, 0], 10);
            rooms[roomId] = room;

            const s1 = io.sockets.sockets.get(p1Id);
            const s2 = io.sockets.sockets.get(p2Id);

            // 分配基础数据层（使用昵称）
            room.players[0] = { id: p1Id, roleId: 1, color: PLAYER_CONFIGS[1].color, name: (s1&&s1._nickname) || PLAYER_CONFIGS[1].name, alive: true, votedRemap: false, votedRerp: false };
            room.players[1] = { id: p2Id, roleId: 2, color: PLAYER_CONFIGS[2].color, name: (s2&&s2._nickname) || PLAYER_CONFIGS[2].name, alive: true, votedRemap: false, votedRerp: false };

            room.gridData = generateRealMap(10);
            room.gameStarted = true;

            if(s1) { s1.roomId = roomId; s1.join(roomId); }
            if(s2) { s2.roomId = roomId; s2.join(roomId); }

            const configs = {
                1: { name: room.players[0].name, color: room.players[0].color },
                2: { name: room.players[1].name, color: room.players[1].color }
            };

            const isRanked = (data && data.ranked) ? true : false;
            io.to(p1Id).emit('game_start', { roomId, myRoleId: 1, maxPlayers: 2, slotTypes: room.slotTypes, activeRoleIds: room.activeRoleIds, configs, gridData: room.gridData, isRanked });
            io.to(p2Id).emit('game_start', { roomId, myRoleId: 2, maxPlayers: 2, slotTypes: room.slotTypes, activeRoleIds: room.activeRoleIds, configs, gridData: room.gridData, isRanked });
        // 🌟 新增：匹配成功后，队列清空，向全服广播更新
            broadcastMatchStatus();
        } else {
            // 🌟 新增：只有1人排队，向全服广播有人等待
            broadcastMatchStatus();
        }
    });

    // 🌟 新增：玩家主动取消匹配的逻辑
    socket.on('leave_matchmaking', () => {
        const oldLen = matchmakingQueue.length;
        // 从队列中过滤掉当前玩家
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        
        // 如果队列长度发生变化，广播最新状态给全服
        if (oldLen !== matchmakingQueue.length) {
            broadcastMatchStatus(); 
        }
    });

    // ---- 功能 2：创建自定义房间（支持槽位设定） ----
    socket.on('create_room', (data) => {
        if (data && data.nickname) socket._nickname = data.nickname;
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
        if (data && data.nickname) socket._nickname = data.nickname;
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
        // 🌟 使用昵称
        let displayName = (data && data.nickname) || socket._nickname || cfg.name;

        room.players[emptySlotIndex] = {
            id: socket.id,
            roleId: currentRoleId,
            color: cfg.color,
            name: displayName,
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
                        gridData: room.gridData,
                        isRanked: false
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
        // 🌟 清理 token 映射
        if (socket._authToken && tokenSockets[socket._authToken] === socket.id) {
            delete tokenSockets[socket._authToken];
        }

        // 新增：玩家断线，在线人数-1并全服广播
        globalOnlineCount = Math.max(0, globalOnlineCount - 1);
        io.emit('server_online_count', { count: globalOnlineCount });
        
        const oldLen = matchmakingQueue.length;
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        if (oldLen !== matchmakingQueue.length) {
            broadcastMatchStatus(); // 如果退出的玩家正好在匹配队列中，广播更新
        }

        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        broadcastMatchStatus();

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
