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
function generateRealMap(N) {
    // 安全熔断：如果外部传入的 N 导致格子数超过了 900 个（比如 N >= 30），强制截断到 29
    // 确保绝对不会发生数组越界或取到 undefined 的情况
    if (N > 30) N = 30;

    const grid = [];
    const terrains = ['white', 'white', 'white', 'gray', 'blue', 'green']; 
    
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
            const terrainType = terrains[Math.floor(Math.random() * terrains.length)];
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
function createRoomObject(maxPlayers, mapSize = MAP_SIZE_DEFAULT) {
    return {
        maxPlayers: maxPlayers,
        mapN: mapSize,
        gameStarted: false,
        gridData: null,
        players: Array(maxPlayers).fill(null) 
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
            room.gridData = generateRealMap(room.mapN);

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

// ==========================================
// 3. Socket 联机事件监听
// ==========================================
io.on('connection', (socket) => {
    // 新增：玩家连接，在线人数+1并全服广播
    globalOnlineCount++;
    // 新上线玩家立刻获取当前匹配队列状态
    socket.emit('matchmaking_status', { count: matchmakingQueue.length });
    io.emit('server_online_count', { count: globalOnlineCount });
    
    // ---- 功能 1：匹配模式 (双人对战快速开局) ----
    socket.on('join_matchmaking', () => {
        
        if (!matchmakingQueue.includes(socket.id)) {
            matchmakingQueue.push(socket.id);
        }

        if (matchmakingQueue.length >= 2) {
            let p1Id = matchmakingQueue.shift();
            let p2Id = matchmakingQueue.shift();

            let roomId = 'MATCH_' + Math.random().toString(36).substr(2, 6).toUpperCase();
            let room = createRoomObject(2, 10); 
            rooms[roomId] = room;

            // 分配基础数据层
            room.players[0] = { id: p1Id, roleId: 1, color: PLAYER_CONFIGS[1].color, name: PLAYER_CONFIGS[1].name, alive: true, votedRemap: false, votedRerp: false };
            room.players[1] = { id: p2Id, roleId: 2, color: PLAYER_CONFIGS[2].color, name: PLAYER_CONFIGS[2].name, alive: true, votedRemap: false, votedRerp: false };

            room.gridData = generateRealMap(10);
            room.gameStarted = true;

            // 将他们加入对应的 Socket 房间
            const s1 = io.sockets.sockets.get(p1Id);
            const s2 = io.sockets.sockets.get(p2Id);
            if(s1) { s1.roomId = roomId; s1.join(roomId); }
            if(s2) { s2.roomId = roomId; s2.join(roomId); }

            // 统一提取前端所需的阵营色彩配置包
            const configs = {
                1: { name: room.players[0].name, color: room.players[0].color },
                2: { name: room.players[1].name, color: room.players[1].color }
            };

            // 直接发送 game_start 跳过等待，无缝无红字切入战场
            io.to(p1Id).emit('game_start', { roomId, myRoleId: 1, maxPlayers: 2, configs, gridData: room.gridData });
            io.to(p2Id).emit('game_start', { roomId, myRoleId: 2, maxPlayers: 2, configs, gridData: room.gridData });
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

    // ---- 功能 2：创建自定义房间（已支持AI数量设定） ----
    socket.on('create_room', (data) => {
        let maxPlayers = parseInt(data.maxPlayers) || 4;
        let aiCount = parseInt(data.aiCount) || 0;
        if(maxPlayers > 4) maxPlayers = 4;
        if(maxPlayers < 2) maxPlayers = 2;
        
        if(aiCount > maxPlayers) aiCount = maxPlayers;
        if(aiCount < 0) aiCount = 0;

        let roomId = Math.random().toString(36).substr(2, 6).toUpperCase(); 
        let mapSize = parseInt(data.mapSize) || 10;
        let room = createRoomObject(maxPlayers, mapSize);
        
        // 🌟【核心新增】：在队列末尾预先填充 AI 角色
        for (let i = maxPlayers - aiCount; i < maxPlayers; i++) {
            let currentRoleId = i + 1;
            let cfg = PLAYER_CONFIGS[currentRoleId];
            room.players[i] = {
                id: 'AI_' + roomId + '_' + currentRoleId,
                roleId: currentRoleId,
                color: cfg.color,
                name: cfg.name + '(AI)',
                alive: true,
                isAI: true, // 标记这是一个 AI
                votedRemap: false,
                votedRerp: false
            };
        }

        // 🌟 新增：如果创建的全部是 AI，直接提前激活房间并生成地图
        // 🌟 修改：如果创建的全部是 AI，不仅生成地图，还要自动分配坐标并启动第一回合
        if (aiCount === maxPlayers) {
            room.gridData = generateRealMap(room.mapN);
            
            // 提取所有安全的出生点
            let safeCells = [];
            for(let r=0; r<room.mapN; r++) {
                for(let c=0; c<room.mapN; c++) {
                    if(room.gridData[r][c].type === 'white') safeCells.push({r, c});
                }
            }
            // 兜底防错
            if(safeCells.length < maxPlayers) safeCells = [{r:0,c:0}, {r:0,c:1}, {r:1,c:0}, {r:1,c:1}];

            // 为所有 AI 分配随机出生点，并写入后端
            room.players.forEach(p => {
                if (p) {
                    let randIdx = Math.floor(Math.random() * safeCells.length);
                    let cell = safeCells.splice(randIdx, 1)[0];
                    p.r = cell.r; 
                    p.c = cell.c;
                }
            });

            room.currentPlayer = 1; // 🌟 关键：设置当前行动者为 1，激活回合引擎！
            room.gameStarted = true;
        }


        rooms[roomId] = room;
        socket.emit('room_created', { roomId: roomId });
    });

    // ---- 功能 3：动态加入自定义房间 ----
    socket.on('join_room', (data) => {
        let roomId = data.roomId;
        if (!rooms[roomId]) {
            socket.emit('join_error', '房间不存在！');
            return;
        }

        let room = rooms[roomId];
        
        // 🌟 因为 AI 占用了末尾的格子，indexOf(null) 会自动找到前方留给真人的空位
        let emptySlotIndex = room.players.indexOf(null);
            if (emptySlotIndex === -1) {
            // 🌟 修改：如果房间满人且游戏已经开始，则让新加入的人自动成为旁观者
            if (room.gameStarted) {
                socket.roomId = roomId;
                socket.join(roomId);
                
                // 🌟 新增：维护旁观者列表，并指定首个加入的旁观者为 AI 宿主
                if (!room.spectators) room.spectators = [];
                room.spectators.push(socket.id);
                // 🌟 修改：如果是 000000 测试房，或者本房间全都是 AI 选手，将进来的第一个真人（创建者）设为宿主
                if ((room.players.every(p => p && p.isAI) || roomId === '000000') && !room.aiHostId) {
                    room.aiHostId = socket.id;
                }
                
                // 提取当前对局的所有已有玩家/AI的配置包
                const globalConfigs = {};
                room.players.forEach((p, idx) => {
                    if (p) globalConfigs[idx + 1] = { name: p.name, color: p.color, isAI: p.isAI || false };
                });

                // 向该连接独立投递旁观者开局包，并附带最新的实时游戏数据缓存
                socket.emit('spectator_start', {
                    roomId: roomId,
                    maxPlayers: room.maxPlayers,
                    configs: globalConfigs,
                    gridData: room.gridData,
                    gameState: room.lastGameState, // 传入全量局势快照（含历史探索、战局日志等）
                    isAIHost: (room.aiHostId === socket.id) // 🌟 新增：向前端同步其宿主身份
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
            name: cfg.name,
            alive: true,
            isAI: false,
            votedRemap: false,
            votedRerp: false
        };

        socket.roomId = roomId;
        socket.join(roomId);

        let currentJoinedCount = room.players.filter(p => p !== null).length;

        io.to(roomId).emit('room_state_update', { 
            roomId: roomId,
            joinedCount: currentJoinedCount,
            maxPlayers: room.maxPlayers
        });

        // 真人到齐 + AI 预填补满，立刻开局！
        if (currentJoinedCount === room.maxPlayers) {
            room.gridData = generateRealMap(room.mapN);
            room.gameStarted = true;

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
            // 同步生存状态至后端内存，防止因信息断层引发意外的无限循环
            if (data.gameState && data.gameState.players) {
                for (let i = 1; i <= room.maxPlayers; i++) {
                    if (data.gameState.players[i] && room.players[i - 1]) {
                        room.players[i - 1].alive = data.gameState.players[i].alive;
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
        else if (room.aiHostId === socket.id && room.players.every(p => p && p.isAI)) {
            executeInstantReset(room, roomId, data.type);
        }
    });

    // ---- 功能 6：断线彻底人间蒸发机制 ----
    socket.on('disconnect', () => {
        
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
            if (roomId === '000000' && room.aiHostId === socket.id) {
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
                    let currentJoinedCount = room.players.filter(p => p !== null).length;
                    io.to(roomId).emit('room_state_update', { 
                        roomId: roomId,
                        joinedCount: currentJoinedCount,
                        maxPlayers: room.maxPlayers
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
        room.gridData = generateRealMap(room.mapN);
        room.players.forEach(p => { if (p) { p.alive = true; p.r = -1; p.c = -1; } });
        io.to(roomId).emit('map_regenerated', { gridData: room.gridData });
        
        // 🌟 核心修复 1：如果是全 AI 房间重开地图，强制在 100 毫秒后自动触发“随机出生”，否则 AI 会因为不会主动点格子而卡死！
        if (room.players.every(p => p && p.isAI)) {
            setTimeout(() => executeInstantReset(room, roomId, 'rerp'), 100);
        }
    } else if (type === 'rerp') {
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
                
                // 🌟 核心修复 2：必须同步更新后端的坐标状态！
                p.r = cell.r; 
                p.c = cell.c; 
                updates[idx + 1] = { r: cell.r, c: cell.c };
            }
        });
        io.to(roomId).emit('positions_randomized', { updates: updates });
        
        // 🌟 核心修复 3：分配完坐标后，必须强制重置回合为 1，并通知前端触发 AI 走位！
        room.currentPlayer = 1;
        io.to(roomId).emit('turn_update', { currentPlayer: 1 });
    }
}

// 监听端口
http.listen(3000, () => {
    console.log('Server is running on port 3000');
});
