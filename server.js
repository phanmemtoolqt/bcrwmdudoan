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
let historicalData = {};

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

// ======================
// PHÂN TÍCH PATTERN - CHỈ LẤY PATTERN
// ======================
function getPattern(history) {
    if (!history || history.length < 5) {
        return 'Chưa đủ dữ liệu';
    }

    const results = history.map(r => {
        const resultStr = String(r.result || '').toUpperCase();
        if (resultStr.includes('BANKER')) return 'B';
        if (resultStr.includes('PLAYER')) return 'P';
        if (resultStr.includes('TIE')) return 'T';
        return '?';
    }).filter(r => r !== '?');

    if (results.length < 5) {
        return 'Chưa đủ dữ liệu';
    }

    // 1. Cầu 1-1 (Đan xen)
    let isAlternating = true;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1] || results[i] === 'T' || results[i-1] === 'T') {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating && results.length >= 4) {
        return 'Cầu 1-1 (Đan xen)';
    }

    // 2. Cầu 2-2 (Kép đôi)
    let isDouble = true;
    for (let i = 0; i < results.length - 1; i += 2) {
        if (i + 1 < results.length) {
            if (results[i] !== results[i+1] || results[i] === 'T') {
                isDouble = false;
                break;
            }
        }
    }
    if (isDouble && results.length >= 4) {
        return 'Cầu 2-2 (Kép đôi)';
    }

    // 3. Cầu vượt (Streak)
    let currentStreak = 1;
    let maxStreak = 1;
    let streakResult = results[0];
    let current = 1;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1] && results[i] !== 'T') {
            current++;
            if (current > maxStreak) {
                maxStreak = current;
                streakResult = results[i];
            }
        } else {
            current = 1;
        }
    }
    
    if (maxStreak >= 3 && streakResult !== 'T') {
        const name = streakResult === 'B' ? 'Banker' : 'Player';
        return `Cầu vượt (${maxStreak} ${name})`;
    }

    // 4. Cầu lệch
    const counts = { B: 0, P: 0, T: 0 };
    results.forEach(r => {
        if (r === 'B') counts.B++;
        else if (r === 'P') counts.P++;
        else if (r === 'T') counts.T++;
    });
    
    const total = results.length;
    const bRatio = counts.B / total;
    const pRatio = counts.P / total;
    const diff = Math.abs(bRatio - pRatio);
    
    if (diff > 0.25) {
        if (bRatio > pRatio) {
            return 'Cầu lệch (Banker)';
        } else {
            return 'Cầu lệch (Player)';
        }
    }

    // 5. Cầu hỗn hợp
    return 'Cầu hỗn hợp';
}

// ======================
// DỰ ĐOÁN - CHỈ LẤY 5 THÔNG TIN
// ======================
function predict(tableName, history) {
    if (!history || history.length < 5) {
        return {
            table: tableName,
            round: 1,
            prediction: 'N/A',
            confidence: '0%',
            pattern: 'Chưa đủ dữ liệu'
        };
    }

    const results = history.map(r => {
        const resultStr = String(r.result || '').toUpperCase();
        if (resultStr.includes('BANKER')) return 'B';
        if (resultStr.includes('PLAYER')) return 'P';
        if (resultStr.includes('TIE')) return 'T';
        return '?';
    }).filter(r => r !== '?');

    if (results.length < 5) {
        return {
            table: tableName,
            round: history.length + 1,
            prediction: 'N/A',
            confidence: '0%',
            pattern: 'Chưa đủ dữ liệu'
        };
    }

    // Lấy pattern
    const pattern = getPattern(history);

    // Dự đoán và độ tin cậy
    let prediction = 'B';
    let confidence = 50;

    // Phân tích để đưa ra dự đoán
    const counts = { B: 0, P: 0, T: 0 };
    results.forEach(r => {
        if (r === 'B') counts.B++;
        else if (r === 'P') counts.P++;
        else if (r === 'T') counts.T++;
    });

    // Kiểm tra cầu đan xen
    let isAlternating = true;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1] || results[i] === 'T' || results[i-1] === 'T') {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating && results.length >= 4) {
        const last = results[results.length - 1];
        prediction = last === 'B' ? 'P' : 'B';
        confidence = 80;
    }
    // Kiểm tra cầu kép đôi
    else {
        let isDouble = true;
        for (let i = 0; i < results.length - 1; i += 2) {
            if (i + 1 < results.length) {
                if (results[i] !== results[i+1] || results[i] === 'T') {
                    isDouble = false;
                    break;
                }
            }
        }
        if (isDouble && results.length >= 4) {
            const last = results[results.length - 1];
            prediction = last === 'B' ? 'B' : 'P';
            confidence = 85;
        }
        // Kiểm tra cầu vượt
        else {
            let currentStreak = 1;
            let maxStreak = 1;
            let streakResult = results[0];
            let current = 1;
            
            for (let i = 1; i < results.length; i++) {
                if (results[i] === results[i-1] && results[i] !== 'T') {
                    current++;
                    if (current > maxStreak) {
                        maxStreak = current;
                        streakResult = results[i];
                    }
                } else {
                    current = 1;
                }
            }
            
            if (maxStreak >= 3 && streakResult !== 'T') {
                prediction = streakResult;
                confidence = Math.min(75 + maxStreak * 3, 95);
            }
            // Dự đoán theo thống kê
            else {
                const bRatio = counts.B / results.length;
                const pRatio = counts.P / results.length;
                
                if (bRatio > pRatio) {
                    prediction = 'B';
                    confidence = Math.round(50 + (bRatio - pRatio) * 100);
                } else if (pRatio > bRatio) {
                    prediction = 'P';
                    confidence = Math.round(50 + (pRatio - bRatio) * 100);
                } else {
                    prediction = 'B';
                    confidence = 55;
                }
                
                if (confidence > 90) confidence = 90;
                if (confidence < 50) confidence = 50;
            }
        }
    }

    // Phiên dự đoán = tổng số kết quả + 1
    const round = history.length + 1;

    return {
        table: tableName,
        round: round,
        prediction: prediction,
        confidence: confidence + '%',
        pattern: pattern
    };
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
            const newData = resp.data.data.map(item => ({
                table: item.table_name || item.table || 'unknown',
                result: item.result || 'Unknown',
                shoeId: item.shoeId || '',
                round: item.round || String(Date.now())
            }));

            baccaratData = newData;
            
            newData.forEach(item => {
                const tableName = item.table;
                if (!historicalData[tableName]) {
                    historicalData[tableName] = [];
                }
                
                const exists = historicalData[tableName].some(
                    h => h.result === item.result && h.round === item.round
                );
                
                if (!exists) {
                    historicalData[tableName].push({
                        result: item.result,
                        round: item.round,
                        shoeId: item.shoeId,
                        timestamp: new Date().toISOString()
                    });
                    
                    if (historicalData[tableName].length > 50) {
                        historicalData[tableName] = historicalData[tableName].slice(-50);
                    }
                }
            });

            lastUpdate = new Date().toISOString();
            console.log(`[${new Date().toLocaleTimeString()}] Đã cập nhật ${newData.length} bàn`);
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

async function autoUpdate() {
    while (true) {
        try {
            await fetchBaccaratData();
        } catch (error) {
            console.error('Auto update error:', error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// ======================
// KHỞI TẠO API SERVER
// ======================
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

app.use(express.json());

// API lấy tất cả bàn
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate: lastUpdate,
        total: baccaratData.length
    });
});

// API lấy theo bàn cụ thể
app.get('/api/baccarat/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => item.table === tableName);
    
    if (found) {
        res.json({ success: true, data: found });
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

// ======================
// API DỰ ĐOÁN - CHỈ 5 THÔNG TIN
// ======================

// Dự đoán cho tất cả bàn - CHỈ 5 THÔNG TIN
app.get('/api/vanhoa', (req, res) => {
    try {
        const predictions = [];
        const tables = Object.keys(historicalData);
        
        tables.forEach(tableName => {
            const history = historicalData[tableName] || [];
            if (history.length >= 5) {
                const result = predict(tableName, history);
                predictions.push(result);
            }
        });
        
        // Sắp xếp theo độ tin cậy giảm dần
        predictions.sort((a, b) => {
            const confA = parseInt(a.confidence) || 0;
            const confB = parseInt(b.confidence) || 0;
            return confB - confA;
        });
        
        res.json({
            success: true,
            total: predictions.length,
            predictions: predictions,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Dự đoán cho bàn cụ thể - CHỈ 5 THÔNG TIN
app.get('/api/vanhoa/:table', (req, res) => {
    try {
        const tableName = req.params.table;
        const history = historicalData[tableName] || [];
        
        if (history.length < 5) {
            return res.json({
                success: false,
                message: `Chưa đủ dữ liệu cho bàn ${tableName}. Cần ít nhất 5 kết quả.`,
                current: history.length
            });
        }
        
        const result = predict(tableName, history);
        res.json({
            success: true,
            prediction: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API lịch sử bàn
app.get('/api/history/:table', (req, res) => {
    const tableName = req.params.table;
    const history = historicalData[tableName] || [];
    
    res.json({
        success: true,
        table: tableName,
        total: history.length,
        data: history,
        timestamp: new Date().toISOString()
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('🃏 BACCARAT DỰ ĐOÁN PRO');
    console.log('========================================');
    
    console.log('[1] 🔐 Đang đăng nhập...');
    const loginOk = await login();
    if (!loginOk) {
        console.error('[ERROR] ❌ Đăng nhập thất bại!');
        process.exit(1);
    }
    console.log('[OK] ✅ Đăng nhập thành công');
    
    console.log('[2] 🚪 Vào lobby...');
    await goToLobby();
    console.log('[OK] ✅ Vào lobby thành công');
    
    console.log('[3] 📥 Lấy dữ liệu lần đầu...');
    await fetchBaccaratData();
    console.log(`[OK] ✅ Đã lấy ${baccaratData.length} bàn`);
    
    console.log(`\n📈 TỔNG QUAN:`);
    console.log(`   - Số bàn: ${Object.keys(historicalData).length}`);
    console.log(`   - Tổng kết quả: ${Object.values(historicalData).reduce((sum, arr) => sum + arr.length, 0)}`);
    
    autoUpdate();
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   📍 http://localhost:${PORT}`);
        console.log(`\n🔮 DỰ ĐOÁN (CHỈ 5 THÔNG TIN):`);
        console.log(`   📊 /api/vanhoa        - Tất cả bàn`);
        console.log(`   🎯 /api/vanhoa/C01    - Bàn cụ thể`);
        console.log(`\n✅ HỆ THỐNG SẴN SÀNG!`);
    });
}

start();
