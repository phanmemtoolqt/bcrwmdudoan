const express = require('express');
const axios = require('axios');
const https = require('https');
const { predictBaccarat, formatBaccaratResponse } = require('./shared/predict');

const app = express();
const port = process.env.PORT || 3000;

// ================== CẤU HÌNH SEXY.JS ==================
const BASE = "https://autobcr.com";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = "vantinh597";
const PASSWORD = "123456";

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;

// Session axios cho sexy
const session = axios.create({
    baseURL: BASE,
    timeout: 30000,
    httpsAgent: agent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
});

// Interceptor lưu cookie
session.interceptors.request.use(config => {
    if (cookieJar) config.headers.Cookie = cookieJar;
    return config;
});

session.interceptors.response.use(res => {
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
        for (const cookie of setCookie) {
            const [name, value] = cookie.split(';')[0].split('=');
            if (cookieJar.includes(`${name}=`)) {
                cookieJar = cookieJar.replace(new RegExp(`${name}=[^;]+;?`), '');
            }
            cookieJar += `${name}=${value}; `;
        }
    }
    return res;
});

// ================== DANH SÁCH BÀN (từ apibcr) ==================
const banThuong = Array.from({ length: 10 }, (_, i) => `BAN${(i + 1).toString().padStart(2, '0')}`);
const banC = Array.from({ length: 16 }, (_, i) => `C${(i + 1).toString().padStart(2, '0')}`);
const banList = [...banThuong, ...banC];

// ================== HÀM TỪ SEXY.JS ==================
function getCsrfToken(html) {
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

async function login() {
    try {
        const getResp = await session.get(LOGIN_URL);
        const token = getCsrfToken(getResp.data);
        
        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        formData.append('_token', token);
        formData.append('action', 'Login');
        
        const headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE,
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        
        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });
        return loginResp.status === 200;
    } catch (error) {
        console.error('Login error:', error.message);
        return false;
    }
}

async function goToLobby() {
    try {
        await session.get(LOBBY_URL);
        return true;
    } catch (error) {
        console.error('Lobby error:', error.message);
        return false;
    }
}

async function fetchBaccaratData() {
    try {
        let xsrfToken = '';
        const xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xsrfMatch) xsrfToken = decodeURIComponent(xsrfMatch[1]);
        
        const headers = {
            'Referer': LOBBY_URL,
            'Origin': BASE,
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        
        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');
        
        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), { headers });
        
        if (resp.data && resp.data.data) {
            baccaratData = resp.data.data.map(item => ({
                table: item.table_name,
                result: item.result,
                ket_qua: item.result,
                shoeId: item.shoeId || '',
                round: item.round || '',
                session: item.session || item.round || item.shoeId  // THÊM FIELD SESSION
            }));
            lastUpdate = new Date().toISOString();
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// ================== BẮT PHIÊN (SESSION) ==================
// Lấy phiên hiện tại từ dữ liệu baccarat
function getCurrentSession() {
    if (!baccaratData || baccaratData.length === 0) {
        return null;
    }
    
    // Tìm phiên lớn nhất hoặc lấy từ bàn đầu tiên
    let maxSession = 0;
    let sessionData = null;
    
    for (const item of baccaratData) {
        const session = item.session || item.round || item.shoeId;
        if (session) {
            const sessionNum = parseInt(session);
            if (!isNaN(sessionNum) && sessionNum > maxSession) {
                maxSession = sessionNum;
                sessionData = session;
            } else if (isNaN(sessionNum) && !sessionData) {
                sessionData = session;
            }
        }
    }
    
    return {
        session: sessionData,
        session_number: maxSession > 0 ? maxSession : null,
        timestamp: lastUpdate,
        total_tables: baccaratData.length
    };
}

// Lấy phiên theo bàn cụ thể
function getSessionByTable(tableName) {
    const table = baccaratData.find(item => item.table === tableName);
    if (!table) return null;
    
    return {
        table: table.table,
        session: table.session || table.round || table.shoeId,
        result: table.result,
        last_update: lastUpdate
    };
}

// Lấy tất cả phiên của các bàn
function getAllSessions() {
    const sessions = {};
    for (const item of baccaratData) {
        sessions[item.table] = {
            session: item.session || item.round || item.shoeId,
            result_preview: item.result ? item.result.substring(0, 20) + '...' : ''
        };
    }
    return sessions;
}

// ================== CÁC HÀM PHÂN TÍCH SIÊU VIP PRO MAX ==================
function duDoan10g1(ket_qua) {
    const clean = ket_qua.replace(/[^PB]/g, '');
    const last10 = clean.slice(-10);
    let P = 0, B = 0;

    for (const c of last10) {
        if (c === 'P') P++;
        if (c === 'B') B++;
    }
    if (P > B) return 'P';
    if (B > P) return 'B';
    return last10.slice(-1) || null;
}

function phatHienCau(ket_qua) {
    const clean = ket_qua.replace(/[^PB]/g, '');
    const last10 = clean.slice(-10);

    if (last10.length < 4) return { loaiCau: 'Không rõ', du_doan: null };

    if (last10.slice(-3).split('').every(v => v === last10.slice(-1))) {
        return { loaiCau: 'Cầu bệt', du_doan: last10.slice(-1) };
    }

    const last4 = last10.slice(-4);
    if (/^(PB){2}$/.test(last4)) return { loaiCau: 'Cầu 1-1', du_doan: 'P' };
    if (/^(BP){2}$/.test(last4)) return { loaiCau: 'Cầu 1-1', du_doan: 'B' };

    const P = (last10.match(/P/g) || []).length;
    const B = (last10.match(/B/g) || []).length;

    if (P >= B + 4) return { loaiCau: 'Cầu nghiêng Con', du_doan: 'P' };
    if (B >= P + 4) return { loaiCau: 'Cầu nghiêng Cái', du_doan: 'B' };

    return { loaiCau: 'Không rõ', du_doan: null };
}

function tinhDoTinCay(ket_qua, loai_cau, du_doan) {
    const clean = ket_qua.replace(/[^PB]/g, '');
    const last10 = clean.slice(-10);

    let score = 50;

    if (loai_cau === 'Cầu bệt') score += 20;
    if (loai_cau === 'Cầu 1-1') score += 15;
    if (loai_cau.includes('nghiêng')) score += 10;

    const P = (last10.match(/P/g) || []).length;
    const B = (last10.match(/B/g) || []).length;

    if (du_doan === 'P' && P > B) score += 10;
    if (du_doan === 'B' && B > P) score += 10;

    if (last10.length < 6) score -= 15;

    return Math.max(30, Math.min(95, score));
}

// ================== LẤY DỮ LIỆU TỪ CACHE ==================
function getDataFromCache() {
    return baccaratData;
}

// ================== CHUẨN HOÁ BÀN ==================
function normalizeBanId(str = '') {
    const s = str.toString().toUpperCase().trim();

    if (/^\d+$/.test(s)) return `BAN${s.padStart(2, '0')}`;
    if (/^C\d+$/.test(s.replace(/O/g, '0')))
        return s.replace(/O/g, '0').replace(/^C(\d)$/, 'C0$1');
    if (/^BAN\d+$/.test(s)) return s.replace(/^BAN(\d)$/, 'BAN0$1');

    return s.replace(/\s+/g, '');
}

// ================== LẤY 1 BÀN CÓ PHÂN TÍCH (SIÊU VIP PRO MAX) ==================
function getBanWithAnalysis(banId) {
    const banNorm = normalizeBanId(banId);
    
    const rawData = baccaratData.find(item => {
        const itemBan = item.table || '';
        return normalizeBanId(itemBan) === banNorm;
    });

    if (!rawData) {
        return { 
            ban: banId, 
            trang_thai: 'Không có dữ liệu',
            ket_qua: '',
            loai_cau: 'Không rõ',
            du_doan: null,
            do_tin_cay: 0,
            last_update: lastUpdate,
            session: null
        };
    }

    const ket_qua = rawData.ket_qua || rawData.result || '';
    
    // Use SIÊU VIP PRO MAX for Baccarat prediction
    const results = ket_qua.replace(/[^PBT]/g, '').split('');
    const pred = predictBaccarat(results);
    
    const cau = phatHienCau(ket_qua);
    const du_doan = pred.val || cau.du_doan || duDoan10g1(ket_qua);
    const do_tin_cay = pred.conf || tinhDoTinCay(ket_qua, cau.loaiCau, du_doan);

    return {
        ban: rawData.table ? rawData.table.toString() : banId,
        ket_qua: ket_qua,
        loai_cau: cau.loaiCau,
        du_doan: du_doan,
        do_tin_cay: do_tin_cay,
        session: rawData.session || rawData.round || rawData.shoeId,
        trang_thai: 'Thành công',
        last_update: lastUpdate,
        thuat_toan: 'SIÊU VIP PRO MAX'
    };
}

// ================== MIDDLEWARE CORS ==================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// ================== API TỪ SEXY.JS ==================
// API lấy tất cả bàn với prediction
app.get('/api/baccarat', (req, res) => {
    const tables = baccaratData.map(item => {
        const ket_qua = item.ket_qua || item.result || '';
        const results = ket_qua.replace(/[^PBT]/g, '').split('');
        const pred = predictBaccarat(results);
        const cntB = results.filter(r => r === 'B').length;
        const cntP = results.filter(r => r === 'P').length;
        const cntT = results.filter(r => r === 'T').length;

        return {
            table_name: item.table || '?',
            time: item.time || '',
            round: item.round || '',
            shoe_id: item.shoeId || '',
            good_road: item.goodRoad || item.good_road || '',
            total: results.length,
            banker: cntB,
            player: cntP,
            tie: cntT,
            result_str: ket_qua,
            last_result: results.length > 0 ? results[results.length - 1] : null,
            last_5: results.slice(-5),
            du_doan: pred.val === 'B' ? 'Banker' : 'Player',
            du_doan_code: pred.val,
            do_tin_cay: pred.conf,
            prob_banker: `${(pred.prob_b * 100).toFixed(1)}%`,
            prob_player: `${(pred.prob_p * 100).toFixed(1)}%`,
            streak: pred.streak,
            pattern_cau: item.goodRoad || item.good_road || 'Đang phân tích',
            thuat_toan: pred.algos
        };
    });

    res.json({
        success: true,
        game: 'bcr',
        total_tables: tables.length,
        tables: tables,
        lastUpdate: lastUpdate
    });
});

// API lấy theo bàn cụ thể với prediction
app.get('/api/baccarat/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => item.table === tableName);
    
    if (found) {
        const ket_qua = found.ket_qua || found.result || '';
        const results = ket_qua.replace(/[^PBT]/g, '').split('');
        const pred = predictBaccarat(results);
        const cntB = results.filter(r => r === 'B').length;
        const cntP = results.filter(r => r === 'P').length;
        const cntT = results.filter(r => r === 'T').length;

        res.json({
            success: true,
            game: 'bcr',
            data: {
                table_name: found.table || '?',
                time: found.time || '',
                round: found.round || '',
                shoe_id: found.shoeId || '',
                good_road: found.goodRoad || found.good_road || '',
                total: results.length,
                banker: cntB,
                player: cntP,
                tie: cntT,
                result_str: ket_qua,
                last_result: results.length > 0 ? results[results.length - 1] : null,
                last_5: results.slice(-5),
                du_doan: pred.val === 'B' ? 'Banker' : 'Player',
                du_doan_code: pred.val,
                do_tin_cay: pred.conf,
                prob_banker: `${(pred.prob_b * 100).toFixed(1)}%`,
                prob_player: `${(pred.prob_p * 100).toFixed(1)}%`,
                streak: pred.streak,
                pattern_cau: found.goodRoad || found.good_road || 'Đang phân tích',
                thuat_toan: pred.algos
            }
        });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

// API lấy kết quả mới nhất
app.get('/api/latest', (req, res) => {
    const latest = [...baccaratData].sort((a, b) => {
        const numA = parseInt(a.table) || 0;
        const numB = parseInt(b.table) || 0;
        return numB - numA;
    });
    res.json({ success: true, data: latest.slice(0, 10), lastUpdate: lastUpdate });
});

// ================== API BẮT PHIÊN (SESSION) ==================
// API lấy phiên hiện tại
app.get('/api/session/current', (req, res) => {
    const session = getCurrentSession();
    if (session) {
        res.json({ success: true, ...session });
    } else {
        res.json({ success: false, message: 'Không thể lấy phiên' });
    }
});

// API lấy phiên theo bàn
app.get('/api/session/table/:tableName', (req, res) => {
    const tableName = req.params.tableName;
    const session = getSessionByTable(tableName);
    if (session) {
        res.json({ success: true, ...session });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

// API lấy tất cả phiên các bàn
app.get('/api/session/all', (req, res) => {
    const sessions = getAllSessions();
    res.json({
        success: true,
        total_tables: Object.keys(sessions).length,
        sessions: sessions,
        last_update: lastUpdate
    });
});

// ================== API TỪ APIBCR.JS (CÓ PHÂN TÍCH) ==================
// API từng bàn có phân tích
banList.forEach(ban => {
    app.get(`/api/${ban.toLowerCase()}`, async (req, res) => {
        try {
            const result = getBanWithAnalysis(ban);
            res.json(result);
        } catch (error) {
            res.status(500).json({ 
                error: 'Lỗi server', 
                message: error.message,
                ban: ban 
            });
        }
    });
});

// API tất cả bàn có phân tích
app.get('/api/ban', async (req, res) => {
    try {
        const result = {};
        for (const ban of banList) {
            result[ban] = getBanWithAnalysis(ban);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

// API full bàn có phân tích
app.get('/api/fullban', async (req, res) => {
    try {
        const danh_sach = {};
        for (const ban of banList) {
            danh_sach[ban] = getBanWithAnalysis(ban);
        }
        res.json({
            tong_ban: banList.length,
            danh_sach,
            last_update: lastUpdate
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

// API check status
app.get('/api/status', async (req, res) => {
    const currentSession = getCurrentSession();
    res.json({
        status: 'running',
        cache_size: baccaratData.length,
        is_cache_array: Array.isArray(baccaratData),
        ban_list: banList,
        total_bans: banList.length,
        last_update: lastUpdate,
        sexy_connected: baccaratData.length > 0,
        current_session: currentSession
    });
});

// ================== KHỞI ĐỘNG SERVER ==================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER (GỘP SEXY + APIBCR + SESSION)');
    console.log('========================================');
    
    console.log('[1] Đang đăng nhập vào autobcr.com...');
    const loginOk = await login();
    if (!loginOk) {
        console.error('[ERROR] Đăng nhập thất bại!');
        process.exit(1);
    }
    console.log('[OK] Đăng nhập thành công');
    
    console.log('[2] Vào lobby...');
    await goToLobby();
    console.log('[OK] Vào lobby thành công');
    
    console.log('[3] Lấy dữ liệu lần đầu...');
    await fetchBaccaratData();
    console.log(`[OK] Đã lấy ${baccaratData.length} bàn`);
    
    // Hiển thị danh sách bàn
    console.log('\n📊 DANH SÁCH BÀN SOURCE:');
    baccaratData.forEach(item => {
        const resultShort = item.result.substring(0, 30) + (item.result.length > 30 ? '...' : '');
        const sessionShow = item.session || item.round || 'N/A';
        console.log(`   ${item.table.padEnd(6)}: ${resultShort} | Phiên: ${sessionShow}`);
    });
    
    console.log('\n📋 DANH SÁCH BÀN PHÂN TÍCH:');
    console.log(`   ${banList.join(', ')}`);
    
    // Hiển thị phiên hiện tại
    const currentSession = getCurrentSession();
    if (currentSession) {
        console.log(`\n🎯 PHIÊN HIỆN TẠI: ${currentSession.session} | Số: ${currentSession.session_number}`);
    }
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    app.listen(port, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY TẠI PORT ${port}:`);
        console.log(`\n📡 API RAW (từ sexy.js):`);
        console.log(`   http://localhost:${port}/api/baccarat`);
        console.log(`   http://localhost:${port}/api/baccarat/1`);
        console.log(`   http://localhost:${port}/api/baccarat/C01`);
        console.log(`   http://localhost:${port}/api/latest`);
        console.log(`\n🎯 API BẮT PHIÊN (SESSION):`);
        console.log(`   http://localhost:${port}/api/session/current`);
        console.log(`   http://localhost:${port}/api/session/table/1`);
        console.log(`   http://localhost:${port}/api/session/all`);
        console.log(`\n📈 API PHÂN TÍCH (từ apibcr.js):`);
        console.log(`   http://localhost:${port}/api/ban`);
        console.log(`   http://localhost:${port}/api/fullban`);
        console.log(`   http://localhost:${port}/api/ban01`);
        console.log(`   http://localhost:${port}/api/c01`);
        console.log(`   http://localhost:${port}/api/status`);
        console.log(`\n⏰ Auto update dữ liệu mỗi 2 giây`);
        console.log(`✅ Server sẵn sàng nhận request`);
    });
}

start();
