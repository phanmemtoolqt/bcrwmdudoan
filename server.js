```javascript
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
let predictionHistory = []; // Lưu lịch sử dự đoán

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

// Interceptor cookie
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
            
            // Tự động cập nhật dự đoán khi có dữ liệu mới
            updatePredictions();
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

// ======================
// THUẬT TOÁN DỰ ĐOÁN AI
// ======================
function analyzePattern(history) {
    if (!history || history.length < 3) return null;
    
    // Tách kết quả thành mảng các lần chơi (B, P, T)
    const rounds = history.split(',').filter(r => r.trim() !== '');
    if (rounds.length < 3) return null;
    
    // Lấy 3 kết quả gần nhất
    const last3 = rounds.slice(-3);
    const last5 = rounds.slice(-5);
    const last10 = rounds.slice(-10);
    
    // Phân tích các pattern
    const patterns = {
        // 1. Pattern cầu bệt (BBB hoặc PPP)
        bệt: false,
        // 2. Pattern cầu 1-1 (BPBP)
        cau11: false,
        // 3. Pattern cầu 2-2 (BBPP)
        cau22: false,
        // 4. Pattern cầu 3-2 (BBBPP)
        cau32: false,
        // 5. Pattern cầu 2-3 (BBPPP)
        cau23: false
    };
    
    // Kiểm tra cầu bệt
    if (last3.every(r => r === last3[0])) {
        patterns.bệt = true;
    }
    
    // Kiểm tra cầu 1-1
    if (last5.length >= 4) {
        const check11 = last5.slice(-4);
        if (check11[0] !== check11[1] && check11[1] !== check11[2] && check11[2] !== check11[3]) {
            patterns.cau11 = true;
        }
    }
    
    // Kiểm tra cầu 2-2
    if (last5.length >= 4) {
        const check22 = last5.slice(-4);
        if (check22[0] === check22[1] && check22[2] === check22[3] && check22[0] !== check22[2]) {
            patterns.cau22 = true;
        }
    }
    
    // Kiểm tra cầu 3-2
    if (last5.length >= 5) {
        const check32 = last5.slice(-5);
        if (check32[0] === check32[1] && check32[1] === check32[2] && 
            check32[3] === check32[4] && check32[0] !== check32[3]) {
            patterns.cau32 = true;
        }
    }
    
    // Kiểm tra cầu 2-3
    if (last5.length >= 5) {
        const check23 = last5.slice(-5);
        if (check23[0] === check23[1] && check23[2] === check23[3] && 
            check23[3] === check23[4] && check23[0] !== check23[2]) {
            patterns.cau23 = true;
        }
    }
    
    // Dự đoán dựa trên pattern
    let prediction = '';
    let confidence = 0;
    let reason = '';
    let patternType = '';
    
    // Ưu tiên pattern mới nhất
    const lastChar = rounds[rounds.length - 1];
    const secondLast = rounds[rounds.length - 2];
    
    if (patterns.bệt) {
        prediction = lastChar;
        confidence = 85;
        reason = `Cầu bệt ${lastChar} đang xuất hiện, nên theo`;
        patternType = 'Cầu bệt';
    } else if (patterns.cau11) {
        prediction = lastChar === 'B' ? 'P' : 'B';
        confidence = 75;
        reason = 'Cầu 1-1 đang hình thành, nên bẻ';
        patternType = 'Cầu 1-1';
    } else if (patterns.cau22) {
        const nextChar = lastChar === 'B' ? 'P' : 'B';
        prediction = nextChar;
        confidence = 70;
        reason = 'Cầu 2-2 đang hình thành, theo cầu';
        patternType = 'Cầu 2-2';
    } else if (patterns.cau32) {
        const nextChar = lastChar === 'B' ? 'P' : 'B';
        prediction = nextChar;
        confidence = 65;
        reason = 'Cầu 3-2 đang hình thành, bẻ cầu';
        patternType = 'Cầu 3-2';
    } else if (patterns.cau23) {
        prediction = lastChar;
        confidence = 65;
        reason = 'Cầu 2-3 đang hình thành, theo cầu';
        patternType = 'Cầu 2-3';
    } else {
        // Phân tích thống kê đơn giản
        const bCount = rounds.filter(r => r === 'B').length;
        const pCount = rounds.filter(r => r === 'P').length;
        const tCount = rounds.filter(r => r === 'T').length;
        
        if (bCount > pCount && bCount > tCount) {
            prediction = 'B';
            confidence = 55;
            reason = 'Banker xuất hiện nhiều hơn trong lịch sử';
            patternType = 'Thống kê';
        } else if (pCount > bCount && pCount > tCount) {
            prediction = 'P';
            confidence = 55;
            reason = 'Player xuất hiện nhiều hơn trong lịch sử';
            patternType = 'Thống kê';
        } else {
            prediction = lastChar === 'B' ? 'P' : 'B';
            confidence = 50;
            reason = 'Không có pattern rõ ràng, bẻ cầu';
            patternType = 'Bẻ cầu';
        }
    }
    
    // Điều chỉnh độ tin cậy dựa trên số lượng mẫu
    if (rounds.length > 20) confidence += 5;
    if (rounds.length > 30) confidence += 5;
    
    return {
        prediction,
        confidence: Math.min(confidence, 95),
        reason,
        pattern: patternType,
        patterns
    };
}

// ======================
// CẬP NHẬT DỰ ĐOÁN
// ======================
function updatePredictions() {
    if (!baccaratData || baccaratData.length === 0) return;
    
    predictionHistory = baccaratData.map(table => {
        const analysis = analyzePattern(table.result);
        
        // Tính phiên dự đoán
        const rounds = table.result ? table.result.split(',').filter(r => r.trim() !== '') : [];
        const nextRound = rounds.length + 1;
        
        return {
            table: table.table,
            round: table.round || '',
            nextRound: nextRound,
            prediction: analysis ? analysis.prediction : 'Chưa đủ dữ liệu',
            confidence: analysis ? analysis.confidence : 0,
            reason: analysis ? analysis.reason : 'Chưa đủ dữ liệu để phân tích',
            pattern: analysis ? analysis.pattern : 'Chưa xác định',
            patterns: analysis ? analysis.patterns : null,
            history: table.result,
            shoeId: table.shoeId || '',
            lastUpdate: new Date().toISOString()
        };
    });
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

// ======================
// API DỰ ĐOÁN CƠ BẢN
// ======================
app.get('/api/predict', (req, res) => {
    const predictions = predictionHistory.map(p => ({
        table: p.table,
        nextRound: p.nextRound,
        prediction: p.prediction,
        confidence: p.confidence,
        reason: p.reason,
        pattern: p.pattern,
        history: p.history,
        lastUpdate: p.lastUpdate
    }));
    
    res.json({
        success: true,
        data: predictions,
        lastUpdate: lastUpdate,
        total: predictions.length
    });
});

// ======================
// API DỰ ĐOÁN CHI TIẾT (VANHOA)
// ======================
app.get('/api/vanhoa', (req, res) => {
    const detailedPredictions = predictionHistory.map(p => {
        // Tạo 5 pattern đầy đủ
        const patterns = p.patterns || {
            bệt: false,
            cau11: false,
            cau22: false,
            cau32: false,
            cau23: false
        };
        
        // Tạo mảng 5 pattern với thông tin chi tiết
        const patternList = [
            { 
                name: 'Cầu bệt', 
                active: patterns.bệt,
                description: patterns.bệt ? 'Đang xuất hiện' : 'Không xuất hiện',
                strength: patterns.bệt ? 85 : 0
            },
            { 
                name: 'Cầu 1-1', 
                active: patterns.cau11,
                description: patterns.cau11 ? 'Đang hình thành' : 'Không xuất hiện',
                strength: patterns.cau11 ? 75 : 0
            },
            { 
                name: 'Cầu 2-2', 
                active: patterns.cau22,
                description: patterns.cau22 ? 'Đang hình thành' : 'Không xuất hiện',
                strength: patterns.cau22 ? 70 : 0
            },
            { 
                name: 'Cầu 3-2', 
                active: patterns.cau32,
                description: patterns.cau32 ? 'Đang hình thành' : 'Không xuất hiện',
                strength: patterns.cau32 ? 65 : 0
            },
            { 
                name: 'Cầu 2-3', 
                active: patterns.cau23,
                description: patterns.cau23 ? 'Đang hình thành' : 'Không xuất hiện',
                strength: patterns.cau23 ? 65 : 0
            }
        ];
        
        // Đếm số pattern đang active
        const activePatterns = patternList.filter(p => p.active);
        
        return {
            table: p.table,
            nextRound: p.nextRound,
            prediction: p.prediction,
            confidence: p.confidence,
            reason: p.reason,
            pattern: p.pattern,
            patternDetails: patternList,
            activePatterns: activePatterns.length,
            history: p.history,
            shoeId: p.shoeId,
            lastUpdate: p.lastUpdate,
            // Thông tin thêm cho dự đoán chuẩn xác
            analysis: {
                totalRounds: p.history ? p.history.split(',').filter(r => r.trim() !== '').length : 0,
                recommended: p.confidence >= 70 ? 'Nên theo' : 'Cân nhắc',
                riskLevel: p.confidence >= 80 ? 'Thấp' : p.confidence >= 60 ? 'Trung bình' : 'Cao'
            }
        };
    });
    
    res.json({
        success: true,
        data: detailedPredictions,
        lastUpdate: lastUpdate,
        total: detailedPredictions.length
    });
});

// ======================
// API LẤY DỰ ĐOÁN THEO BÀN
// ======================
app.get('/api/predict/:table', (req, res) => {
    const tableName = req.params.table;
    const found = predictionHistory.find(p => p.table === tableName);
    
    if (found) {
        // Trả về dự đoán chi tiết cho bàn cụ thể
        const patterns = found.patterns || {
            bệt: false,
            cau11: false,
            cau22: false,
            cau32: false,
            cau23: false
        };
        
        const patternList = [
            { name: 'Cầu bệt', active: patterns.bệt },
            { name: 'Cầu 1-1', active: patterns.cau11 },
            { name: 'Cầu 2-2', active: patterns.cau22 },
            { name: 'Cầu 3-2', active: patterns.cau32 },
            { name: 'Cầu 2-3', active: patterns.cau23 }
        ];
        
        res.json({
            success: true,
            data: {
                ...found,
                patterns: patternList,
                analysis: {
                    totalRounds: found.history ? found.history.split(',').filter(r => r.trim() !== '').length : 0,
                    activePatterns: patternList.filter(p => p.active).length,
                    recommended: found.confidence >= 70 ? 'Nên theo' : 'Cân nhắc',
                    riskLevel: found.confidence >= 80 ? 'Thấp' : found.confidence >= 60 ? 'Trung bình' : 'Cao'
                }
            }
        });
    } else {
        res.json({ 
            success: false, 
            message: 'Không tìm thấy bàn ' + tableName 
        });
    }
});

// ======================
// API LẤY LỊCH SỬ (GIỮ NGUYÊN)
// ======================
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

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER + AI PREDICTION');
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
    
    // Hiển thị danh sách bàn và dự đoán
    console.log('\n📊 DANH SÁCH BÀN VÀ DỰ ĐOÁN:');
    predictionHistory.forEach(item => {
        console.log(`   ${item.table.padEnd(4)}: Phiên ${item.nextRound} -> ${item.prediction} (${item.confidence}%) - ${item.pattern}`);
    });
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   http://localhost:${PORT}/api/baccarat - Lịch sử`);
        console.log(`   http://localhost:${PORT}/api/predict - Dự đoán cơ bản`);
        console.log(`   http://localhost:${PORT}/api/vanhoa - Dự đoán chi tiết (5 pattern)`);
        console.log(`   http://localhost:${PORT}/api/predict/1 - Dự đoán bàn cụ thể`);
        console.log(`   http://localhost:${PORT}/api/latest - 10 bàn mới nhất`);
        console.log(`\n⏰ Auto update mỗi 2 giây`);
        console.log(`🧠 AI Prediction đã sẵn sàng với 5 pattern phân tích`);
    });
}

start();
```
