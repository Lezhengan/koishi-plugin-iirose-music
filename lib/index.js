"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.name = void 0;
exports.apply = apply;
const fs_1 = require("fs");
const path_1 = require("path");
const koishi_1 = require("koishi");
exports.name = 'iirose-music';
/** 音质中文名（与 ShadowSee API 源码注释一致） */
const QUALITY_ZH = {
    standard: '标准',
    higher: '极高',
    exhigh: '高',
    lossless: '无损',
    hires: 'Hi-Res',
    jyeffect: '高清环绕声',
    sky: '沉浸环绕声',
    jymaster: '超清母带',
};
exports.Config = koishi_1.Schema.object({
    apiBase: koishi_1.Schema.string().default('https://api.shadowsee.icu').description('ShadowSee API 基地址'),
    quality: koishi_1.Schema.union([
        koishi_1.Schema.const('standard').description('标准'),
        koishi_1.Schema.const('higher').description('极高'),
        koishi_1.Schema.const('exhigh').description('高'),
        koishi_1.Schema.const('lossless').description('无损'),
        koishi_1.Schema.const('hires').description('Hi-Res'),
        koishi_1.Schema.const('sky').description('沉浸环绕声'),
        koishi_1.Schema.const('jyeffect').description('高清环绕声'),
        koishi_1.Schema.const('jymaster').description('超清母带'),
    ]).default('standard').description('默认音质'),
    cookie: koishi_1.Schema.string().description('网易云 Cookie（可选），用于播放 VIP 歌曲'),
    login: koishi_1.Schema.string().role('netease-login').description('网易云扫码登录（手机扫码后自动填充 Cookie 配置项）'),
    commandHead: koishi_1.Schema.string().default('>').description('指令前缀'),
    musicHot: koishi_1.Schema.boolean().default(true).description('是否自动发送网易云热评'),
    hotCommentLimit: koishi_1.Schema.number().min(3).max(20).step(1).default(3).description('热评随机抽取数量（3-20，默认3）；请求返回的热评条数，机器人从这批热评中随机发一条'),
    botTable: koishi_1.Schema.array(koishi_1.Schema.object({
        botId: koishi_1.Schema.string().description('机器人 ID（selfId）'),
        roomId: koishi_1.Schema.string().description('房间 ID（channelId）'),
    })).role('table').default([]).description('播放归属表：同一行表示「roomId 这个房间的指令，交给 botId 这个机器人播放」。IIROSE 的媒体只能由机器人发进它自己所在的房间，无法跨房间，所以这里只能按房间挑机器人（典型场景：同一个房间里挂了多个机器人账号，指定其中一个负责点歌）；留空则自动使用接收消息的那个机器人'),
    debug: koishi_1.Schema.boolean().default(false).description('调试日志（记录点歌/播放全流程，用于排查问题）'),
    randomCNIP: koishi_1.Schema.boolean().default(false).description('【实验性】请求附加 randomCNIP=true 使用随机中国IP（可绕过部分地区访问限制，默认关闭）'),
});
function apply(ctx, config) {
    const logger = ctx.logger('iirose-music');
    const comHead = config.commandHead;
    /** ctx.command 入口在非 IIROSE 会话（或没有可用机器人）时的统一提示 */
    const NO_BOT_HINT = '本插件仅支持 IIROSE 平台，且当前没有可用的 IIROSE 机器人';
    const API_BASE = config.apiBase.replace(/\/+$/, '');
    // ==================== 调试日志 ====================
    // 仅当 config.debug 开启时输出，用于排查点歌/播放/热评等异常
    function dlog(...args) {
        if (config.debug)
            logger.info('[DEBUG]', ...args);
    }
    // 热接受 debug 开关变更，无需重启插件
    ctx.scope.accept(['debug'], (newConfig) => {
        config.debug = newConfig.debug;
    });
    // IIROSE 协议会把 < > & 等字符实体转义（如 > → &gt;），
    // 收到的消息可能未经 adapter 还原，这里做兜底解码，保证指令前缀能正确匹配
    function decodeEntities(str) {
        const map = {
            '&amp;': '&', '&lt;': '<', '&gt;': '>',
            '&quot;': '"', '&#39;': "'", '&#x2F;': '/',
        };
        const re = /&amp;|&lt;|&gt;|&quot;|&#39;|&#x2F;/g;
        let last = '';
        let decoded = str;
        while (last !== decoded) {
            last = decoded;
            decoded = last.replace(re, (e) => map[e]);
        }
        return decoded;
    }
    // 确保 HTTP 服务可用（裸环境下 koishi 4 不会自动加载 ctx.http）
    if (!ctx.http)
        ctx.plugin(koishi_1.HTTP);
    // ==================== Cookie 持久化 ====================
    // 优先使用配置项；为空时尝试从数据文件加载（控制台扫码登录后保存）
    const COOKIE_FILE = (0, path_1.join)(ctx.baseDir, 'data', 'netease_cookie.json');
    function saveCookieToFile(cookie) {
        try {
            (0, fs_1.mkdirSync)((0, path_1.dirname)(COOKIE_FILE), { recursive: true });
            (0, fs_1.writeFileSync)(COOKIE_FILE, JSON.stringify({
                cookie,
                login_time: new Date().toLocaleString('zh-CN', { hour12: false }),
            }, null, 2), 'utf8');
        }
        catch (e) {
            logger.warn('Cookie 文件保存失败', e);
        }
    }
    if (!config.cookie) {
        try {
            if ((0, fs_1.existsSync)(COOKIE_FILE)) {
                const data = JSON.parse((0, fs_1.readFileSync)(COOKIE_FILE, 'utf8'));
                if (data.cookie) {
                    config.cookie = data.cookie;
                    logger.info('已从数据文件加载网易云 Cookie');
                }
            }
        }
        catch (e) {
            logger.warn('Cookie 文件读取失败', e);
        }
    }
    // 热接受 cookie 配置变更：扫码登录或前端修改 cookie 时只更新该字段，
    // 不重载整个插件（避免正在进行的点歌队列/播放状态丢失）
    ctx.scope.accept(['cookie'], (newConfig) => {
        config.cookie = newConfig.cookie;
    });
    // ==================== 全局状态 ====================
    // 选歌交互：key 为 `机器人ID:用户ID`，避免多个机器人（多个房间）之间互相顶掉选择状态
    const waitUser = new Map();
    const waitKey = (session) => `${session.selfId}:${session.userId ?? ''}`;
    let musicHot = config.musicHot;
    /** 播放归属表：按房间指定负责播放的机器人 */
    const botTable = Array.isArray(config.botTable) ? config.botTable.filter(r => r && r.botId && r.roomId) : [];
    /**
     * 播放状态按机器人（房间）分桶。
     * 同一个 Koishi 里可以挂多个 iirose adapter，各自待在不同房间，
     * 队列 / 播放模式 / 当前曲 / 跳过标记必须各管各的，否则一个房间的操作会打断另一个房间。
     */
    const botStates = new Map();
    function getState(selfId) {
        const key = String(selfId);
        let st = botStates.get(key);
        if (!st) {
            st = {
                list: [],
                playing: false,
                nowPlaySong: null,
                skipList: [],
                sleepPlay: [],
                nowMediaSongId: '',
                timeSleep: [false, ''],
                model: true, // true=顺序 false=随机
                modelRe: false, // true=循环
            };
            botStates.set(key, st);
        }
        return st;
    }
    // ==================== ShadowSee API ====================
    async function shadowseeGet(path, params = {}) {
        if (config.cookie)
            params['cookie'] = config.cookie;
        // 实验性：附加 randomCNIP=true 使用随机中国IP（默认关闭）
        if (config.randomCNIP)
            params['randomCNIP'] = true;
        // 附加时间戳防止 API/CDN 缓存旧响应（API 会忽略未知参数，已实测无副作用）
        params['timestamp'] = Date.now();
        const query = new URLSearchParams(params).toString();
        const url = query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
        dlog('API 请求:', path, params);
        const res = await ctx.http.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36' },
            timeout: 30000,
        });
        dlog('API 响应:', path, 'code =', res?.code, typeof res === 'object' ? Object.keys(res).slice(0, 8).join(',') : typeof res);
        return res;
    }
    // ==================== 工具 ====================
    /** 按 selfId 找 iirose 机器人（机器人重连/重载后 selfId 不变，所以用 selfId 而不是对象引用） */
    function getBotById(selfId) {
        for (const bot of ctx.bots) {
            if (bot.platform === 'iirose' && String(bot.selfId) === String(selfId))
                return bot;
        }
        return undefined;
    }
    /** 该房间在播放归属表里指定的机器人；没配则返回 undefined */
    function getTableBot(roomId) {
        if (!roomId)
            return undefined;
        for (const row of botTable) {
            if (String(row.roomId) !== String(roomId))
                continue;
            const bot = getBotById(row.botId);
            if (!bot)
                logger.warn(`播放归属表：房间 ${roomId} 指定的机器人 ${row.botId} 当前不在线，已回退为会话机器人`);
            return bot;
        }
        return undefined;
    }
    /**
     * 决定这次播放由哪个机器人执行。
     * adapter 的 makeMusic 不接受房间参数（媒体随机器人自己的连接发出），
     * 只能由机器人播进它自己所在的房间，无法跨房间指定，所以这里只能反过来按房间挑机器人：
     *   1. 播放归属表里配了该房间 -> 用表里指定的机器人
     *   2. 否则用接收这条消息的那个机器人
     */
    function resolveBot(session) {
        if (session?.bot?.platform !== 'iirose')
            return undefined;
        return getTableBot(session.channelId || session.guildId || '') || session.bot;
    }
    /** 取本次会话对应的机器人与它的播放状态（ctx.command 入口共用） */
    function getSessionState(session) {
        const bot = resolveBot(session);
        return { bot, st: bot ? getState(bot.selfId) : null };
    }
    /** IIROSE 艾特格式（与 iirose_music.py 的 at_user 一致： [*用户名*] ） */
    function atUser(session) {
        return ` [*${session.username || session.userId}*] `;
    }
    /** 从媒体链接/文本中解析网易云歌曲id，兼容 ?id=、/play/、纯数字 */
    function parseIdFromText(text) {
        const m = text.match(/[?&]id=(\d+)/);
        if (m)
            return m[1];
        const m2 = text.match(/\/play\/(\d+)/);
        if (m2)
            return m2[1];
        if (/^\d+$/.test(text.trim()))
            return text.trim();
        return null;
    }
    /** 解析媒体播放事件的来源链接/直链中的歌曲id */
    function parseMediaSongId(url) {
        const m = url.match(/id=(\d+)/);
        if (m)
            return m[1];
        const m2 = url.match(/\/play\/(\d+)/);
        if (m2)
            return m2[1];
        return null;
    }
    // ==================== 歌词处理 ====================
    function mergeLrc(lrc, tlyric) {
        const lMap = new Map();
        for (const line of lrc.split('\n')) {
            const parts = line.split(']');
            if (parts.length === 2)
                lMap.set(parts[0].substring(1), parts[1]);
        }
        const tMap = new Map();
        for (const line of tlyric.split('\n')) {
            const parts = line.split(']');
            if (parts.length === 2)
                tMap.set(parts[0].substring(1), parts[1]);
        }
        for (const [time, text] of tMap) {
            if (lMap.has(time) && text)
                lMap.set(time, lMap.get(time) + ' | ' + text);
        }
        return [...lMap.entries()].map(([t, l]) => `[${t}] ${l}`).join('\n');
    }
    async function getLyric(musicId) {
        try {
            const data = await shadowseeGet('/lyric', { id: musicId });
            if (data.tlyric && data.tlyric.lyric && data.lrc) {
                return mergeLrc(data.lrc.lyric, data.tlyric.lyric);
            }
            if (data.lrc && data.lrc.lyric)
                return data.lrc.lyric;
        }
        catch (e) {
            logger.warn('歌词获取失败', e);
        }
        return '[00:00.000] 歌词获取失败';
    }
    // ==================== 播放核心 ====================
    async function playNMedia(bot, st, musicId, nameText) {
        if (!bot)
            return 'error';
        if (nameText === '[电台') {
            // ===== 电台节目 =====
            const songLrc = await getLyric(musicId);
            try {
                const progData = await shadowseeGet('/dj/program/detail', { id: musicId });
                const mainSong = progData.program.mainSong;
                const auther = (mainSong.artists || []).map(a => a.name).join('、');
                const urlData = await shadowseeGet('/song/url/v1', {
                    id: mainSong.id,
                    level: config.quality,
                });
                if (!urlData.data || !urlData.data[0])
                    return 'error';
                const songUrl = urlData.data[0].url;
                if (!songUrl)
                    return 'error';
                const songUrlInfo = urlData.data[0];
                const songName = `${nameText}|${QUALITY_ZH[config.quality] || config.quality}] ${mainSong.name}`;
                st.nowMediaSongId = String(mainSong.id);
                const d = Math.max(1, Math.round((songUrlInfo.time || mainSong.duration || mainSong.dt || 0) / 1000));
                bot.internal.makeMusic({
                    type: 'music',
                    name: songName,
                    signer: auther,
                    cover: progData.program.coverUrl,
                    link: `s://music.163.com/#/song?id=${progData.program.id}`,
                    url: songUrl,
                    duration: d,
                    bitRate: Math.round((songUrlInfo.br || 128000) / 1000),
                    color: '#5b9bd5',
                    lyrics: songLrc,
                    origin: 'netease',
                });
                return d;
            }
            catch (e) {
                logger.warn('电台播放失败', e);
                return 'error';
            }
        }
        // ===== 普通歌曲 =====
        dlog('playNMedia 开始:', { musicId, nameText, quality: config.quality, botFound: !!bot });
        const songLrc = await getLyric(musicId);
        try {
            const urlData = await shadowseeGet('/song/url/v1', {
                id: musicId,
                level: config.quality,
            });
            if (!urlData.data || !urlData.data[0])
                return 'error';
            const songUrl = urlData.data[0].url;
            dlog('获取播放地址:', { musicId, hasUrl: !!songUrl, br: urlData.data[0]?.br });
            if (!songUrl)
                return 'error';
            const songUrlInfo = urlData.data[0];
            const detailData = await shadowseeGet('/song/detail', { ids: musicId });
            const songInfo = detailData.songs[0];
            dlog('歌曲信息:', { id: songInfo?.id, name: songInfo?.name, dt: songInfo?.dt });
            const auther = (songInfo.ar || songInfo.artists || []).map(a => a.name).join('、');
            const songName = nameText ? `${nameText}|${QUALITY_ZH[config.quality] || config.quality}] ${songInfo.name}` : songInfo.name;
            st.nowMediaSongId = String(songInfo.id);
            const duration = Math.max(1, Math.round((songUrlInfo.time || songInfo.dt || 0) / 1000));
            dlog('调用 makeMusic:', { songName, auther, duration, url: songUrl.slice(0, 80) });
            bot.internal.makeMusic({
                type: 'music',
                name: songName,
                signer: auther,
                cover: songInfo.al.picUrl,
                link: `s://music.163.com/#/song?id=${songInfo.id}`,
                url: songUrl,
                duration,
                bitRate: Math.round((songUrlInfo.br || 128000) / 1000),
                color: '#5b9bd5',
                lyrics: songLrc,
                origin: 'netease',
            });
            return duration;
        }
        catch (e) {
            logger.warn('歌曲播放失败', e);
            return 'error';
        }
    }
    // ==================== 搜索 ====================
    async function searchList(keyword, offset, type) {
        const mOffset = offset === 1 ? 0 : (offset - 1) * 10;
        try {
            if (type === 'music') {
                const req = await shadowseeGet('/search', { keywords: keyword, limit: 10, type: 1, offset: mOffset });
                if (req.code !== 200 || !req.result)
                    return { code: 404, list: [] };
                const list = [];
                req.result.songs.forEach((s, i) => {
                    const ar = s.ar || s.artists || [];
                    list.push({ id: s.id, show: `${i + 1}.${s.name} by: ${ar.map(a => a.name).join('/')} \n` });
                });
                return { code: 200, list };
            }
            if (type === 'playlist') {
                const req = await shadowseeGet('/search', { keywords: keyword, limit: 10, type: 1000, offset: mOffset });
                if (req.code !== 200 || !req.result)
                    return { code: 404, list: [] };
                const list = [];
                req.result.playlists.forEach((p, i) => {
                    list.push({ id: p.id, show: `${i + 1}.${p.name} 共${p.trackCount}首 by: ${p.creator.nickname} \n` });
                });
                return { code: 200, list };
            }
            if (type === 'album') {
                const req = await shadowseeGet('/search', { keywords: keyword, limit: 10, type: 10, offset: mOffset });
                if (req.code !== 200 || !req.result)
                    return { code: 404, list: [] };
                const list = [];
                req.result.albums.forEach((p, i) => {
                    list.push({ id: p.id, show: `${i + 1}.${p.name} by: ${p.artist.name}\n` });
                });
                return { code: 200, list };
            }
            if (type === 'artists') {
                const req = await shadowseeGet('/search', { keywords: keyword, limit: 10, type: 100, offset: mOffset });
                if (req.code !== 200 || !req.result)
                    return { code: 404, list: [] };
                const list = [];
                req.result.artists.forEach((p, i) => {
                    list.push({ id: p.id, show: `${i + 1}.${p.name}\n` });
                });
                return { code: 200, list };
            }
            if (type === 'radio') {
                const req = await shadowseeGet('/search', { keywords: keyword, limit: 10, type: 1009, offset: mOffset });
                if (req.code !== 200 || !req.result)
                    return { code: 404, list: [] };
                const list = [];
                for (let i = 0; i < req.result.djRadios.length; i++) {
                    const dj = await shadowseeGet('/dj/detail', { rid: req.result.djRadios[i].id });
                    list.push({ id: req.result.djRadios[i].id, show: `${i + 1}.${dj.data.name} by: ${dj.data.dj.nickname}\n` });
                }
                return { code: 200, list };
            }
            if (type === 'radioProgram') {
                // 电台搜索结果选择电台后，进入该电台的节目列表逐条选择（与点歌搜索逻辑一致）
                const req = await shadowseeGet('/dj/program', { rid: keyword, limit: 100 });
                if (req.code !== 200 || !req.programs)
                    return { code: 404, list: [] };
                const start = (offset - 1) * 10;
                const list = [];
                req.programs.slice(start, start + 10).forEach((p, i) => {
                    const ar = p.mainSong?.artists || [];
                    list.push({ id: p.id, show: `${i + 1}.${p.mainSong.name} by: ${ar.map(a => a.name).join('/')}\n` });
                });
                return { code: 200, list };
            }
        }
        catch (e) {
            logger.warn('搜索失败', e);
        }
        return { code: 404, list: [] };
    }
    function hintText(type, offset) {
        const page = `发送 下一页/上一页 切换到下一页或上一页 当前页数：第${offset}页`;
        if (type === 'music')
            return `发送左侧序号播放对应歌曲或发送 退出 退出点歌\n${page}`;
        if (type === 'playlist')
            return `发送左侧序号播放对应歌单或发送 退出 退出搜索\n${page}`;
        if (type === 'album')
            return `发送左侧序号播放对应专辑或发送 退出 退出搜索\n${page}`;
        if (type === 'artists')
            return `发送左侧序号播放对应歌手或发送 退出 退出搜索\n${page}`;
        if (type === 'radioProgram')
            return `发送左侧序号播放对应节目或发送 退出 退出选择\n${page}`;
        return '注：电台有音频解析失败的可能，未必所有音频可播放\n发送左侧序号播放对应电台或发送 退出 退出搜索';
    }
    async function sendSearchResult(session, bot, keyword, type) {
        const key = waitKey(session);
        dlog('sendSearchResult 开始:', { keyword, type, userId: session.userId, botId: bot?.selfId });
        if (!bot) {
            waitUser.delete(key);
            await session.send(atUser(session) + '错误，当前没有可用的 IIROSE 机器人');
            return;
        }
        const result = await searchList(keyword, 1, type);
        dlog('搜索结果:', { keyword, type, code: result.code, count: result.list.length });
        if (result.code !== 200) {
            waitUser.delete(key);
            await session.send(atUser(session) + '错误，获取数据失败，已退出选择');
            return;
        }
        let msg = '';
        result.list.forEach(item => { msg += item.show; });
        msg += hintText(type, 1);
        waitUser.set(key, { list: result.list, offset: 1, keyword, type });
        await session.send(atUser(session) + '\n' + msg);
    }
    async function showOffset(session, wait) {
        const result = await searchList(wait.keyword, wait.offset, wait.type);
        if (result.code !== 200) {
            await session.send(atUser(session) + '错误，获取数据失败，已退出选择');
            return;
        }
        wait.list = result.list;
        let msg = '';
        result.list.forEach(item => { msg += item.show; });
        msg += hintText(wait.type, wait.offset);
        await session.send(atUser(session) + '\n' + msg);
    }
    // ==================== 队列添加 ====================
    async function addToQueue(session, st, type, id) {
        try {
            if (type === 'playlist') {
                const detail = await shadowseeGet('/playlist/detail', { id });
                if (!detail.playlist)
                    return 404;
                const listData = `${detail.playlist.name} by: ${detail.playlist.creator.nickname}`;
                const pages = Math.ceil(detail.playlist.trackCount / 1000) || 1;
                for (let i = 1; i <= pages; i++) {
                    const req = await shadowseeGet('/playlist/track/all', { id, limit: i * 1000, offset: (i - 1) * 1000 });
                    if (req.code === 404 || !req.songs)
                        return 404;
                    for (const s of req.songs) {
                        const ar = s.ar || [];
                        st.list.push([s.id, s.name, ar.map(a => a.name).join('/'), '歌单', listData]);
                    }
                }
                await session.send(atUser(session) + '歌单添加完毕！');
                return 0;
            }
            if (type === 'album') {
                const req = await shadowseeGet('/album', { id });
                if (!req.album)
                    return 404;
                const listData = `${req.album.name} by: ${req.album.artist.name}`;
                for (const s of req.songs || []) {
                    const ar = s.ar || [];
                    st.list.push([s.id, s.name, ar.map(a => a.name).join('/'), '专辑', listData]);
                }
                await session.send(atUser(session) + '专辑添加完毕！');
                return 0;
            }
            if (type === 'radio') {
                const req = await shadowseeGet('/dj/program', { rid: id });
                if (req.code === 404 || !req.programs)
                    return 404;
                const djDetail = await shadowseeGet('/dj/detail', { rid: id });
                const listName = `${djDetail.data.name} by: ${djDetail.data.dj.nickname}`;
                for (const p of req.programs) {
                    st.list.push([p.id, p.mainSong.name, p.mainSong.artists.map(a => a.name).join('/'), '电台', listName]);
                }
                await session.send(atUser(session) + '电台添加完毕！');
                return 0;
            }
            if (type === 'artists') {
                const req = await shadowseeGet('/artist/songs', { id });
                for (const s of req.songs || []) {
                    const ar = s.ar || [];
                    st.list.push([s.id, s.name, ar.map(a => a.name).join('/'), '歌手', String(id)]);
                }
                await session.send(atUser(session) + '该歌手作品已添加完毕！');
                return 0;
            }
        }
        catch (e) {
            logger.warn('队列添加失败', e);
        }
        return 404;
    }
    // ==================== 选择交互处理 ====================
    async function handleWaitUser(session, msg) {
        const key = waitKey(session);
        const wait = waitUser.get(key);
        if (msg === '上一页') {
            if (wait.offset > 1)
                wait.offset--;
            await showOffset(session, wait);
            return true;
        }
        if (msg === '下一页') {
            wait.offset++;
            await showOffset(session, wait);
            return true;
        }
        if (msg === '退出') {
            waitUser.delete(key);
            await session.send(atUser(session) + '已退出');
            return true;
        }
        const num = Number(msg);
        if (!Number.isInteger(num)) {
            await session.send(atUser(session) + '错误：输入内容非1-10纯数字|退出请发送 退出');
            return true;
        }
        if (num < 1 || num > 10) {
            await session.send(atUser(session) + '错误：输入内容超出了1-10|退出请发送 退出');
            return true;
        }
        const item = wait.list[num - 1];
        if (!item) {
            await session.send(atUser(session) + '错误：输入序号无效');
            return true;
        }
        waitUser.delete(key);
        const { bot, st } = getSessionState(session);
        if (wait.type === 'music') {
            await session.send(atUser(session) + '解析中...');
            const status = await playNMedia(bot, st, item.id, '[单歌');
            if (status === 'error') {
                await session.send(atUser(session) + '内部错误：解析失败，已退出点歌');
            }
            return true;
        }
        if (wait.type === 'radio') {
            // 电台：进入该电台的节目列表逐条选择（与点歌搜索逻辑一致）
            waitUser.set(key, { list: [], offset: 1, keyword: String(item.id), type: 'radioProgram' });
            await showOffset(session, waitUser.get(key));
            return true;
        }
        if (wait.type === 'radioProgram') {
            await session.send(atUser(session) + '解析中...');
            const status = await playNMedia(bot, st, item.id, '[电台');
            if (status === 'error') {
                await session.send(atUser(session) + '内部错误：解析失败，已退出选择');
            }
            return true;
        }
        await session.send(atUser(session) + '正在添加中...');
        await addToQueue(session, st, wait.type, item.id);
        return true;
    }
    // ==================== 命令处理 ====================
    async function playById(session, bot, st, text) {
        const id = parseIdFromText(text);
        dlog('playById:', { text, parsedId: id });
        if (!id) {
            await session.send(atUser(session) + '错误，没有从输入的信息中找到歌曲id');
            return;
        }
        const status = await playNMedia(bot, st, id, '[单歌');
        if (status === 'error') {
            await session.send(atUser(session) + '致命错误，运行崩溃');
        }
    }
    async function addListById(session, st, type, text) {
        const id = parseIdFromText(text);
        if (id) {
            const code = await addToQueue(session, st, type, id);
            if (code === 404) {
                const nameMap = { music: '歌曲', playlist: '歌单', album: '专辑', radio: '电台', artists: '歌手', radioProgram: '节目' };
                await session.send(atUser(session) + `错误，未知${nameMap[type]}`);
            }
        }
        else {
            await session.send(atUser(session) + '错误，没有从输入的信息中找到歌曲id');
        }
    }
    async function showList(session, st) {
        if (!st.list.length) {
            await session.send('当前队列中暂无歌曲');
            return;
        }
        const result = new Map();
        for (const item of st.list) {
            const category = item[3];
            const name = item[4];
            if (!result.has(category))
                result.set(category, new Map());
            const m = result.get(category);
            m.set(name, (m.get(name) || 0) + 1);
        }
        let msg = '';
        for (const [category, items] of result) {
            msg += `${category}：\n`;
            let count = 0;
            for (const [name, quantity] of items) {
                count++;
                msg += `  - ${name} - 剩余 ${quantity} 首\n`;
            }
        }
        await session.send(atUser(session) + '\n' + msg.slice(0, -1));
    }
    function modelText(st) { return st.model ? '顺序' : '随机'; }
    function reText(st) { return st.modelRe ? '是' : '否'; }
    /** 帮助菜单（>帮助 / 帮助 共用） */
    function helpMenu() {
        return `${comHead}点歌 (歌名) - 搜索网易云歌曲，可解析VIP歌曲\n`
            + `${comHead}点歌id (歌曲id) - 按id播放网易云歌曲\n`
            + `${comHead}列表 - 查看在列表中的歌\n`
            + `${comHead}列表 删除 (歌单/专辑/电台 名) - 删除在列表中包含指定 歌单/专辑/电台 名的歌曲\n`
            + `${comHead}跳过 - 跳过当前机器人播放的歌曲\n`
            + `${comHead}跳过 列表 - 跳过当前队列中的歌曲\n`
            + `${comHead}清空 - 清空队列中的所有歌曲\n`
            + `${comHead}歌单 搜索 (歌单名) - 搜索网易云歌单\n`
            + `${comHead}歌单 id (歌单id) - 用歌单id播放歌单\n`
            + `${comHead}专辑 搜索 (专辑名) - 搜索网易云专辑\n`
            + `${comHead}专辑 id (专辑id) - 用专辑id播放专辑\n`
            + `${comHead}电台 搜索 (电台名) - 搜索网易云电台\n`
            + `${comHead}电台 id (电台id) - 用电台id播放电台\n`
            + `${comHead}歌手 搜索 (歌手名) - 搜索网易云歌手\n`
            + `${comHead}歌手 id (歌手id) - 用歌手id播放歌手所有歌曲\n`
            + `${comHead}模式 - 查询当前模式状态\n`
            + `${comHead}模式 列表/循环 - 更改 列表/循环 的状态\n`
            + `PS：左侧的 ${comHead} 为指令头，() 中包裹的内容为参数`;
    }
    async function handleCommand(session, msg) {
        const rest = msg.substring(comHead.length).trim();
        const { bot, st } = getSessionState(session);
        dlog('handleCommand 进入:', { comHead, rest, botId: bot?.selfId });
        try {
            if (rest.startsWith('点歌id ')) {
                dlog('执行命令: 点歌id');
                await playById(session, bot, st, rest.substring(5));
            }
            else if (rest.startsWith('点歌 ')) {
                dlog('执行命令: 点歌');
                await sendSearchResult(session, bot, rest.substring(3), 'music');
            }
            else if (rest.startsWith('跳过 列表')) {
                // 与 py 版一致：在公屏发送 cut 触发切歌
                await session.send('cut');
                if (st.list.length) {
                    st.playing = false;
                    if (st.nowPlaySong && !st.skipList.includes(String(st.nowPlaySong[0])))
                        st.skipList.push(String(st.nowPlaySong[0]));
                }
            }
            else if (rest === '跳过') {
                await session.send('cut');
            }
            else if (rest === '清空') {
                st.list = [];
                await session.send(atUser(session) + '已清空当前列表！');
            }
            else if (rest === '列表') {
                await showList(session, st);
            }
            else if (rest.startsWith('列表 删除 ')) {
                const name = rest.substring(6);
                const before = st.list.length;
                st.list = st.list.filter(item => item[4] !== name);
                if (st.list.length !== before)
                    await session.send(`已删除 ${name}！`);
                else
                    await session.send(`未找到包含 ${name} 的媒体`);
            }
            else if (rest.startsWith('歌单 搜索 ')) {
                await sendSearchResult(session, bot, rest.substring(6), 'playlist');
            }
            else if (rest.startsWith('歌单 ')) {
                await addListById(session, st, 'playlist', rest.substring(3));
            }
            else if (rest.startsWith('专辑 搜索 ')) {
                await sendSearchResult(session, bot, rest.substring(6), 'album');
            }
            else if (rest.startsWith('专辑 ')) {
                await addListById(session, st, 'album', rest.substring(3));
            }
            else if (rest.startsWith('电台 搜索 ')) {
                await sendSearchResult(session, bot, rest.substring(6), 'radio');
            }
            else if (rest.startsWith('电台 ')) {
                await addListById(session, st, 'radio', rest.substring(3));
            }
            else if (rest.startsWith('歌手 搜索 ')) {
                await sendSearchResult(session, bot, rest.substring(6), 'artists');
            }
            else if (rest.startsWith('歌手 ')) {
                await addListById(session, st, 'artists', rest.substring(3));
            }
            else if (rest === '模式') {
                await session.send(`当前状态：\n播放模式：${modelText(st)} 循环播放：${reText(st)}`);
            }
            else if (rest.startsWith('模式 ')) {
                const text = rest.substring(3);
                if (text.startsWith('列表'))
                    st.model = !st.model;
                else if (text.startsWith('循环'))
                    st.modelRe = !st.modelRe;
                await session.send(`当前状态：\n播放模式：${modelText(st)} 循环播放：${reText(st)}`);
            }
            else if (rest === '帮助') {
                await session.send(atUser(session) + '\n' + helpMenu());
            }
        }
        catch (e) {
            logger.warn('命令执行失败', e);
        }
    }
    // ==================== 消息事件 ====================
    ctx.on('message', async (session) => {
        if (session.bot.platform !== 'iirose')
            return;
        // 先还原实体转义（> → &gt; 等），再匹配指令前缀
        const msg = decodeEntities(session.content ?? '').trim();
        if (!msg)
            return;
        const userId = session.userId ?? '';
        dlog('收到消息:', { userId, username: session.username, selfId: session.selfId, content: msg });
        // 选择交互（命令优先）；key 里带机器人ID，多个房间同时选歌不会互相顶掉
        if (waitUser.has(waitKey(session)) && !msg.startsWith(comHead) && msg !== '<TT1') {
            if (await handleWaitUser(session, msg))
                return;
        }
        if (msg.startsWith(comHead)) {
            dlog('命中指令前缀, 进入命令处理:', comHead, '|', msg);
            await handleCommand(session, msg);
            return;
        }
        if (msg.startsWith('<TT1')) {
            musicHot = !musicHot;
            await session.send(String(musicHot));
        }
    });
    // ==================== 媒体播放事件（热评 + 队列计时） ====================
    // 热评仅在媒体来源匹配时才发起 /comment/hot?id= 请求，避免对 CDN 直链等未知来源误发
    const HOT_COMMENT_SOURCE_RE = /shadowsee|music\.163\.com|music\.126\.net|163\.cn|tencentscf|tcloudbase|cloudfunctions/i;
    ctx.on('iirose/music-play', async (session, data) => {
        try {
            const bot = session.bot;
            const st = getState(bot.selfId);
            let songId = parseMediaSongId(data.link) || parseMediaSongId(data.url);
            // CDN直链无法解析id时，仅机器人自己播放的歌曲用记录的id兜底
            if (!songId && data.owner === bot.selfId)
                songId = st.nowMediaSongId;
            dlog('music-play 事件:', { link: data.link, url: data.url, owner: data.owner, selfId: bot.selfId, parsedSongId: songId, nowMediaSongId: st.nowMediaSongId, musicHot });
            if (!songId)
                return;
            if (String(songId) === st.timeSleep[1])
                st.timeSleep[0] = true;
            if (!musicHot)
                return;
            // 媒体来源必须是 shadowsee / 网易云 / 腾讯云云函数 才触发热评请求
            const mediaSource = `${data.link} ${data.url}`;
            if (!HOT_COMMENT_SOURCE_RE.test(mediaSource)) {
                dlog('热评跳过: 媒体来源不匹配', { link: data.link, url: data.url?.slice(0, 80) });
                return;
            }
            const hot = await shadowseeGet('/comment/hot', { id: songId, type: 0, limit: config.hotCommentLimit });
            if (hot.code === 200 && hot.hotComments && hot.hotComments.length) {
                const msg = hot.hotComments[Math.floor(Math.random() * hot.hotComments.length)];
                const text = `\\\\\\*\n### 网易云热评：\n**${msg.content}**  ——**${msg.user.nickname}** *(${msg.timeStr})*`;
                await bot.sendMessage(bot.config.roomId, text);
            }
        }
        catch (e) {
            logger.warn('热评发送失败', e);
        }
    });
    // ==================== 后台队列播放 ====================
    /** 按当前模式从队列里取下一首（顺序=出队，随机=随机取，循环=取完放回队尾） */
    function pickSong(st) {
        if (st.modelRe) {
            if (st.model) {
                const song = st.list.shift();
                st.list.push(song);
                return song;
            }
            return st.list[Math.floor(Math.random() * st.list.length)];
        }
        if (st.model)
            return st.list.shift();
        const idx = Math.floor(Math.random() * st.list.length);
        return st.list.splice(idx, 1)[0];
    }
    /** 等这首歌放完再把 playing 放开，让队列推进下一首（每个机器人各自计时，互不阻塞） */
    async function waitSongEnd(st, duration, songId) {
        await (0, koishi_1.sleep)(duration * 1000);
        if (!st.skipList.includes(songId)) {
            st.playing = false;
        }
        else {
            const idx = st.skipList.indexOf(songId);
            if (idx > -1)
                st.skipList.splice(idx, 1);
        }
    }
    async function playTick() {
        for (const [selfId, st] of botStates) {
            if (st.playing || !st.list.length)
                continue;
            const bot = getBotById(selfId);
            if (!bot)
                continue;
            // playing 在任何 await 之前就置位，避免下一轮 tick 重复取歌
            st.playing = true;
            const playSong = pickSong(st);
            st.nowPlaySong = playSong;
            st.timeSleep[1] = String(playSong[0]);
            const songTime = await playNMedia(bot, st, playSong[0], `[${playSong[3]}`);
            if (songTime === 'error' || songTime === 0) {
                st.playing = false;
                continue;
            }
            st.sleepPlay = [songTime, String(playSong[0])];
        }
    }
    async function sleepTick() {
        for (const [selfId, st] of botStates) {
            // 等 music-play 事件确认这首歌真的开始了，再按歌长计时
            if (!st.sleepPlay.length || !st.timeSleep[0])
                continue;
            st.timeSleep[0] = false;
            const [duration, songId] = st.sleepPlay;
            st.sleepPlay = [];
            waitSongEnd(st, duration, songId).catch(e => logger.warn('队列计时异常', e));
        }
    }
    ctx.setInterval(() => { playTick().catch(e => logger.warn('队列播放异常', e)); }, 500);
    ctx.setInterval(() => { sleepTick().catch(() => { }); }, 500);
    // ==================== 控制台扫码登录（网易云） ====================
    // 扫码登录完整流程（不依赖 iirose adapter，走 HTTP 直连 ShadowSee API）：
    //   1. 前端点击「获取二维码」 -> 监听器 get-qrcode -> ShadowSee /login/qr/key 拿到 unikey，
    //      再用 unikey 调 /login/qr/create 生成二维码图片（base64 数据），返回给前端展示
    //   2. 前端拿到 unikey 后每 3 秒轮询一次监听器 check-login -> ShadowSee /login/qr/check，
    //      根据返回 code 判断状态（801 待扫码 / 802 已扫码待确认 / 803 登录成功 / 800 过期）
    //   3. 登录成功（803）时从返回的 cookie 串里提取 MUSIC_U 字段，拼上 os/appver 后
    //      写入内存 config.cookie 并持久化到 data/netease_cookie.json，此后即可播放 VIP 歌曲
    // 相关接口：/login/qr/key、/login/qr/create、/login/qr/check
    /** 第一步：向 ShadowSee 申请一次登录会话，返回二维码对应的 unikey（uuid） */
    async function generateUnikey() {
        const res = await shadowseeGet('/login/qr/key', { timestamp: Date.now() });
        if (res.code !== 200 || !res.data?.unikey)
            throw new Error(`获取二维码失败: code=${res.code}`);
        return res.data.unikey;
    }
    /**
     * 第二步：用 unikey 轮询扫码状态（前端每 3 秒调用一次）
     * 返回 { code, message, cookie? }，其中 code 含义：
     *   800 = 二维码过期  801 = 等待扫码  802 = 已扫码待手机确认  803 = 登录成功
     */
    async function checkLogin(unikey) {
        const res = await shadowseeGet('/login/qr/check', { key: unikey, timestamp: Date.now() });
        const code = res.code;
        if (code === 803) {
            // 登录成功：从返回的 cookie 串中提取 MUSIC_U 令牌（网易云登录凭证），
            // 并拼接固定参数（os=pc、appver=8.9.70）组成可直接使用的完整 cookie
            const m = String(res.cookie || '').match(/MUSIC_U=[^;]+/);
            if (m) {
                const fullCookie = `${m[0]};os=pc;appver=8.9.70;`;
                config.cookie = fullCookie;
                saveCookieToFile(config.cookie);
                // 自动回填到 Koishi 配置（koishi.yml），前端「插件配置」页会同步显示 cookie 值
                ctx.scope.update({ ...ctx.scope.config, cookie: fullCookie });
                return { code, message: '登录成功！Cookie 已保存并自动填入插件配置', cookie: config.cookie };
            }
            return { code, message: '登录成功但未获取到 Cookie' };
        }
        const messages = {
            800: '二维码已过期，请重新获取',
            801: '等待扫码中...',
            802: '已扫码，请在手机上确认登录',
        };
        return { code, message: messages[code] || `未知状态(${code})` };
    }
    // 仅在加载了 console 服务时注册前端入口和事件监听器
    ctx.using(['console'], (ctx) => {
        // 注册控制台客户端入口（前端构建产物 dist/，开发时用 client/index.ts）
        ctx.console.addEntry({
            dev: (0, path_1.resolve)(__dirname, '../client/index.ts'),
            prod: (0, path_1.resolve)(__dirname, '../dist'),
        });
        // 前端事件「获取二维码」：申请 unikey 并生成二维码图片，返回 { unikey, qrcode(base64) }
        ctx.console.addListener('iirose-music/get-qrcode', async () => {
            const unikey = await generateUnikey();
            const res = await shadowseeGet('/login/qr/create', { key: unikey, qrimg: true, timestamp: Date.now() });
            if (res.code !== 200 || !res.data?.qrimg)
                throw new Error(`生成二维码失败: code=${res.code}`);
            return { unikey, qrcode: res.data.qrimg };
        });
        // 前端事件「查询登录状态」：把 unikey 交给 checkLogin 轮询（803 时保存 Cookie）
        ctx.console.addListener('iirose-music/check-login', async (unikey) => {
            return checkLogin(unikey);
        });
    });
    // ==================== 注册 Koishi 命令（帮助指引） ====================
    // 与自定义前缀（comHead，默认 ">"）双轨并行：
    //   - ">点歌 xxx" 仍由 handleCommand 处理（保持原使用习惯）
    //   - "点歌 xxx"（无前缀）由 Koishi 命令系统处理
    // 注册后这些命令会出现在 help / 命令列表中，提供使用指引
    ctx.command('点歌 [keyword:text]', `网易云音乐点歌，${comHead}帮助 查看完整菜单`)
        .action(async ({ session }, keyword) => {
        if (!session)
            return;
        if (!keyword)
            return await session.send(atUser(session) + '\n' + helpMenu());
        const { bot } = getSessionState(session);
        if (!bot)
            return NO_BOT_HINT;
        await sendSearchResult(session, bot, keyword.trim(), 'music');
    });
    ctx.command('点歌.id <id:text>', '按id播放歌曲')
        .action(async ({ session }, id) => {
        if (!session)
            return;
        if (!id)
            return '请提供歌曲ID，例如：点歌 id 33894312';
        const { bot, st } = getSessionState(session);
        if (!bot)
            return NO_BOT_HINT;
        await playById(session, bot, st, id.trim());
    });
    ctx.command('点歌.列表 [操作:text]', '查看/删除队列')
        .action(async ({ session }, operation) => {
        if (!session)
            return;
        const { bot, st } = getSessionState(session);
        if (!bot)
            return NO_BOT_HINT;
        if (operation && operation.startsWith('删除 ')) {
            const name = operation.substring(3).trim();
            const before = st.list.length;
            st.list = st.list.filter(item => item[4] !== name);
            if (st.list.length !== before)
                await session.send(`已删除 ${name}！`);
            else
                await session.send(`未找到包含 ${name} 的媒体`);
        }
        else {
            await showList(session, st);
        }
    });
    ctx.command('点歌.跳过 [选项]', '跳过当前歌曲')
        .action(async ({ session }, option) => {
        if (!session)
            return;
        const { bot, st } = getSessionState(session);
        if (!bot)
            return NO_BOT_HINT;
        if (option === '列表') {
            // 与 py 版一致：在公屏发送 cut 触发切歌
            await session.send('cut');
            if (st.list.length) {
                st.playing = false;
                if (st.nowPlaySong && !st.skipList.includes(String(st.nowPlaySong[0])))
                    st.skipList.push(String(st.nowPlaySong[0]));
            }
        }
        else {
            await session.send('cut');
        }
    });
    ctx.command('点歌.清空', '清空队列')
        .action(async ({ session }) => {
        if (!session)
            return;
        const { bot, st } = getSessionState(session);
        if (!bot)
            return NO_BOT_HINT;
        st.list = [];
        await session.send(atUser(session) + '已清空当前列表！');
    });
    ctx.command('点歌.歌单 [操作:text]', '播放歌单')
        .action(async ({ session }, operation) => {
        if (!session)
            return;
        if (!operation)
            return '请提供歌单ID，例如：点歌 歌单 3778678';
        const text = operation.trim();
        if (text.startsWith('搜索 ')) {
            const { bot } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await sendSearchResult(session, bot, text.substring(3).trim(), 'playlist');
        }
        else {
            const { bot, st } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await addListById(session, st, 'playlist', text);
        }
    });
    ctx.command('点歌.专辑 [操作:text]', '播放专辑')
        .action(async ({ session }, operation) => {
        if (!session)
            return;
        if (!operation)
            return '请提供专辑ID，例如：点歌 专辑 32311';
        const text = operation.trim();
        if (text.startsWith('搜索 ')) {
            const { bot } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await sendSearchResult(session, bot, text.substring(3).trim(), 'album');
        }
        else {
            const { bot, st } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await addListById(session, st, 'album', text);
        }
    });
    ctx.command('点歌.电台 [操作:text]', '播放电台')
        .action(async ({ session }, operation) => {
        if (!session)
            return;
        if (!operation)
            return '请提供电台ID，例如：点歌 电台 3365568';
        const text = operation.trim();
        if (text.startsWith('搜索 ')) {
            const { bot } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await sendSearchResult(session, bot, text.substring(3).trim(), 'radio');
        }
        else {
            const { bot, st } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await addListById(session, st, 'radio', text);
        }
    });
    ctx.command('点歌.歌手 [操作:text]', '播放歌手作品')
        .action(async ({ session }, operation) => {
        if (!session)
            return;
        if (!operation)
            return '请提供歌手ID，例如：点歌 歌手 6452';
        const text = operation.trim();
        if (text.startsWith('搜索 ')) {
            const { bot } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await sendSearchResult(session, bot, text.substring(3).trim(), 'artists');
        }
        else {
            const { bot, st } = getSessionState(session);
            if (!bot)
                return NO_BOT_HINT;
            await addListById(session, st, 'artists', text);
        }
    });
    ctx.command('点歌.模式 [选项]', '查看/切换播放模式')
        .action(async ({ session }, option) => {
        if (!session)
            return;
        const { bot, st } = getSessionState(session);
        if (!bot)
            return NO_BOT_HINT;
        if (option === '列表')
            st.model = !st.model;
        else if (option === '循环')
            st.modelRe = !st.modelRe;
        await session.send(`当前状态：\n播放模式：${modelText(st)} 循环播放：${reText(st)}`);
    });
    logger.info(`网易云音乐插件已加载 (ShadowSee API: ${API_BASE}, 音质: ${QUALITY_ZH[config.quality] || config.quality}, 热评: ${musicHot ? '开' : '关'})`);
}
