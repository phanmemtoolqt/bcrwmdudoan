const axios = require('axios');
const express = require('express');
const https = require('https');

// ======================
// CẤU HÌNH
// ======================
const BASE = "https://autobcr.com";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/wm/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = "bucumh";
const PASSWORD = "123456";

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;

// ======================
// SESSION AXIOS
// ======================
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

// ======================
// LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

// ======================
// ĐĂNG NHẬP
// ======================
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

// ======================
// VÀO LOBBY
// ======================
async function goToLobby() {
    try {
        await session.get(LOBBY_URL);
        return true;
    } catch (error) {
        console.error('Lobby error:', error.message);
        return false;
    }
}

// ======================
// LẤY KẾT QUẢ BACCARAT
// ======================
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
                shoeId: item.shoeId || '',
                round: item.round || ''
            }));
            lastUpdate = new Date().toISOString();
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

// ======================================================
// 🧠 THUẬT TOÁN DỰ ĐOÁN
// ======================================================
function predictNext(resultString) {
    if (!resultString || resultString.length === 0) {
        return { 
            prediction: 'N/A', 
            confidence: 0, 
            pattern: 'Chưa có dữ liệu',
            total_pattern: 0
        };
    }

    const history = resultString.split('');
    const total = history.length;
    
    // Lấy 20 ván gần nhất
    const recent = history.slice(-20);
    const len = recent.length;
    if (len === 0) {
        return { 
            prediction: 'N/A', 
            confidence: 0, 
            pattern: 'Không đủ dữ liệu',
            total_pattern: total
        };
    }

    // Đếm tần suất có trọng số
    const weights = recent.map((_, idx) => 1 + (idx / len) * 2);
    const counts = { B: 0, P: 0, T: 0 };
    for (let i = 0; i < len; i++) {
        const ch = recent[i];
        if (counts[ch] !== undefined) counts[ch] += weights[i];
    }

    // Tìm kết quả có điểm cao nhất
    let maxLabel = 'B';
    let maxScore = 0;
    for (const [label, score] of Object.entries(counts)) {
        if (score > maxScore) {
            maxScore = score;
            maxLabel = label;
        }
    }

    // Tính độ tin cậy
    const totalScore = counts.B + counts.P + counts.T;
    let confidence = totalScore > 0 ? (maxScore / totalScore) * 100 : 0;
    confidence = Math.round(confidence);

    // Phân tích pattern
    let pattern = '';
    let streak = 1;
    for (let i = len - 1; i > 0; i--) {
        if (recent[i] === recent[i-1]) streak++;
        else break;
    }
    const lastChar = recent[len-1];
    if (streak >= 3) {
        pattern = `${lastChar === 'B' ? 'Banker' : lastChar === 'P' ? 'Player' : 'Tie'} đang chuỗi ${streak}`;
    } else {
        const pCount = recent.filter(ch => ch === 'P').length;
        const bCount = recent.filter(ch => ch === 'B').length;
        const tCount = recent.filter(ch => ch === 'T').length;
        if (pCount > bCount && pCount > tCount) {
            pattern = `Player chiếm ưu thế (${Math.round(pCount/len*100)}%)`;
        } else if (bCount > pCount && bCount > tCount) {
            pattern = `Banker chiếm ưu thế (${Math.round(bCount/len*100)}%)`;
        } else {
            pattern = `Cầu đan xen (B:${bCount} P:${pCount} T:${tCount})`;
        }
    }

    return {
        prediction: maxLabel,
        confidence: confidence,
        pattern: pattern,
        total_pattern: total
    };
}

// ======================
// VÒNG LẶP TỰ ĐỘNG CẬP NHẬT
// ======================
async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// ======================
// KHỞI TẠO API SERVER
// ======================
const app = express();

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// ----------------------
// API LỊCH SỬ
// ----------------------
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate: lastUpdate,
        total: baccaratData.length
    });
});

app.get('/api/baccarat/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => item.table === tableName);
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

app.get('/api/latest', (req, res) => {
    const latest = [...baccaratData].sort((a, b) => {
        const numA = parseInt(a.table) || 0;
        const numB = parseInt(b.table) || 0;
        return numB - numA;
    });
    res.json({ success: true, data: latest.slice(0, 10), lastUpdate: lastUpdate });
});

// ----------------------
// 🧠 API DỰ ĐOÁN
// ----------------------
// Dự đoán cho tất cả bàn
app.get('/api/predict', (req, res) => {
    const predictions = baccaratData.map(item => {
        const pred = predictNext(item.result);
        return {
            tên_bàn: item.table,
            tổng_pattern: pred.total_pattern,
            phiên_dự_đoán: pred.total_pattern + 1, // pattern + 1
            dự_đoán: pred.prediction,
            độ_tin_cậy: pred.confidence,
            pattern: pred.pattern
        };
    });
    res.json({
        success: true,
        data: predictions,
        lastUpdate: lastUpdate,
        total: predictions.length
    });
});

// Dự đoán cho một bàn cụ thể
app.get('/api/predict/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => item.table === tableName);
    if (!found) {
        return res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
    const pred = predictNext(found.result);
    res.json({
        success: true,
        data: {
            tên_bàn: found.table,
            tổng_pattern: pred.total_pattern,
            phiên_dự_đoán: pred.total_pattern + 1, // pattern + 1
            dự_đoán: pred.prediction,
            độ_tin_cậy: pred.confidence,
            pattern: pred.pattern
        },
        lastUpdate: lastUpdate
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER + DỰ ĐOÁN');
    console.log('========================================');
    
    console.log('[1] Đang đăng nhập...');
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
    
    // Hiển thị danh sách bàn và dự đoán mẫu
    console.log('\n📊 DỰ ĐOÁN SƠ BỘ:');
    baccaratData.slice(0, 5).forEach(item => {
        const pred = predictNext(item.result);
        console.log(`   ${item.table.padEnd(4)} -> Phiên ${pred.total_pattern + 1}: ${pred.prediction} (${pred.confidence}%) - ${pred.pattern}`);
    });
    console.log('   ... (xem chi tiết tại /api/predict)');
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   📜 Lịch sử: http://localhost:${PORT}/api/baccarat`);
        console.log(`   🔮 Dự đoán tất cả: http://localhost:${PORT}/api/predict`);
        console.log(`   🔮 Dự đoán 1 bàn: http://localhost:${PORT}/api/predict/1`);
        console.log(`   🕒 Cập nhật mỗi 2 giây`);
    });
}

start();
