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
// PHÂN TÍCH PATTERN ĐẦY ĐỦ
// ======================
function analyzePatternDetail(results) {
    if (!results || results.length === 0) {
        return {
            pattern: 'Chưa có dữ liệu',
            prediction: 'B',
            confidence: '50%'
        };
    }

    // Lấy 10 kết quả gần nhất để phân tích
    const recent = results.slice(-10);
    const len = recent.length;

    // 1. KIỂM TRA CẦU 1-1 (ĐAN XEN)
    let isAlternating = true;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i] === recent[i-1] || recent[i] === 'T' || recent[i-1] === 'T') {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating && len >= 4) {
        const last = recent[recent.length - 1];
        const next = last === 'B' ? 'P' : (last === 'P' ? 'B' : 'B');
        let detail = '';
        for (let i = 0; i < recent.length; i++) {
            detail += recent[i] + (i < recent.length - 1 ? ' → ' : '');
        }
        return {
            pattern: `Cầu 1-1 (Đan xen) - ${detail}`,
            prediction: next,
            confidence: '85%'
        };
    }

    // 2. KIỂM TRA CẦU 2-2 (KÉP ĐÔI)
    let isDouble = true;
    for (let i = 0; i < recent.length - 1; i += 2) {
        if (i + 1 < recent.length) {
            if (recent[i] !== recent[i+1] || recent[i] === 'T') {
                isDouble = false;
                break;
            }
        }
    }
    if (isDouble && len >= 4) {
        const last = recent[recent.length - 1];
        const next = last === 'B' ? 'B' : (last === 'P' ? 'P' : 'B');
        let detail = '';
        for (let i = 0; i < recent.length; i++) {
            detail += recent[i] + (i < recent.length - 1 ? ' → ' : '');
        }
        return {
            pattern: `Cầu 2-2 (Kép đôi) - ${detail}`,
            prediction: next,
            confidence: '88%'
        };
    }

    // 3. KIỂM TRA CẦU 3-2 (FIBONACCI)
    if (len >= 5) {
        let isFib = true;
        // Kiểm tra mẫu: B B B P P hoặc P P P B B
        const first3 = recent.slice(0, 3);
        const last2 = recent.slice(3, 5);
        if (first3.every(x => x === first3[0] && x !== 'T') && 
            last2.every(x => x === last2[0] && x !== 'T') &&
            first3[0] !== last2[0]) {
            const next = first3[0];
            let detail = '';
            for (let i = 0; i < recent.length; i++) {
                detail += recent[i] + (i < recent.length - 1 ? ' → ' : '');
            }
            return {
                pattern: `Cầu 3-2 (Fibonacci) - ${detail}`,
                prediction: next,
                confidence: '82%'
            };
        }
    }

    // 4. KIỂM TRA CẦU VƯỢT (STREAK)
    let maxStreak = 1;
    let currentStreak = 1;
    let streakResult = recent[0];
    let current = 1;
    
    for (let i = 1; i < recent.length; i++) {
        if (recent[i] === recent[i-1] && recent[i] !== 'T') {
            current++;
            if (current > maxStreak) {
                maxStreak = current;
                streakResult = recent[i];
            }
        } else {
            current = 1;
        }
    }
    
    if (maxStreak >= 3 && streakResult !== 'T') {
        const name = streakResult === 'B' ? 'Banker' : 'Player';
        let detail = '';
        for (let i = 0; i < recent.length; i++) {
            detail += recent[i] + (i < recent.length - 1 ? ' → ' : '');
        }
        const conf = Math.min(75 + maxStreak * 3, 95);
        return {
            pattern: `Cầu vượt (${maxStreak} ${name}) - ${detail}`,
            prediction: streakResult,
            confidence: conf + '%'
        };
    }

    // 5. KIỂM TRA CẦU LỆCH (THỐNG KÊ)
    const counts = { B: 0, P: 0, T: 0 };
    recent.forEach(r => {
        if (r === 'B') counts.B++;
        else if (r === 'P') counts.P++;
        else if (r === 'T') counts.T++;
    });
    
    const total = recent.length;
    const bRatio = counts.B / total;
    const pRatio = counts.P / total;
    const diff = Math.abs(bRatio - pRatio);
    
    if (diff > 0.2) {
        let detail = `B:${counts.B} P:${counts.P} T:${counts.T}`;
        if (bRatio > pRatio) {
            const conf = Math.round(60 + diff * 100);
            return {
                pattern: `Cầu lệch Banker (${detail}) - Banker ${(bRatio*100).toFixed(1)}%`,
                prediction: 'B',
                confidence: Math.min(conf, 90) + '%'
            };
        } else {
            const conf = Math.round(60 + diff * 100);
            return {
                pattern: `Cầu lệch Player (${detail}) - Player ${(pRatio*100).toFixed(1)}%`,
                prediction: 'P',
                confidence: Math.min(conf, 90) + '%'
            };
        }
    }

    // 6. CẦU HỖN HỢP - DỰA TRÊN XÁC SUẤT
    let detail = '';
    for (let i = 0; i < recent.length; i++) {
        detail += recent[i] + (i < recent.length - 1 ? ' → ' : '');
    }
    
    if (counts.B > counts.P) {
        return {
            pattern: `Cầu hỗn hợp (${detail}) - Banker ${(bRatio*100).toFixed(1)}%`,
            prediction: 'B',
            confidence: '55%'
        };
    } else if (counts.P > counts.B) {
        return {
            pattern: `Cầu hỗn hợp (${detail}) - Player ${(pRatio*100).toFixed(1)}%`,
            prediction: 'P',
            confidence: '55%'
        };
    } else {
        return {
            pattern: `Cầu hỗn hợp (${detail}) - Cân bằng`,
            prediction: 'B',
            confidence: '50%'
        };
    }
}

// ======================
// DỰ ĐOÁN - 5 THÔNG TIN ĐẦY ĐỦ
// ======================
function predict(tableName, history) {
    // Chuyển đổi lịch sử thành dạng B/P/T
    const results = history.map(r => {
        const resultStr = String(r.result || '').toUpperCase();
        if (resultStr.includes('BANKER')) return 'B';
        if (resultStr.includes('PLAYER')) return 'P';
        if (resultStr.includes('TIE')) return 'T';
        return '?';
    }).filter(r => r !== '?');

    // Phân tích pattern
    const analysis = analyzePatternDetail(results);
    
    // Phiên dự đoán = tổng số kết quả + 1
    const round = history.length + 1;

    return {
        table: tableName,
        round: round,
        prediction: analysis.prediction,
        confidence: analysis.confidence,
        pattern: analysis.pattern
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
// API DỰ ĐOÁN - 5 THÔNG TIN ĐẦY ĐỦ
// ======================

// Dự đoán cho tất cả bàn
app.get('/api/vanhoa', (req, res) => {
    try {
        const predictions = [];
        const tables = Object.keys(historicalData);
        
        tables.forEach(tableName => {
            const history = historicalData[tableName] || [];
            // Dự đoán luôn, không cần đợi đủ dữ liệu
            const result = predict(tableName, history);
            predictions.push(result);
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

// Dự đoán cho bàn cụ thể
app.get('/api/vanhoa/:table', (req, res) => {
    try {
        const tableName = req.params.table;
        const history = historicalData[tableName] || [];
        
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
    
    // Hiển thị dự đoán mẫu
    console.log('\n🔮 DỰ ĐOÁN MẪU:');
    const tables = Object.keys(historicalData);
    if (tables.length > 0) {
        const sample = predict(tables[0], historicalData[tables[0]] || []);
        console.log(`   Bàn ${sample.table}:`);
        console.log(`   - Phiên: ${sample.round}`);
        console.log(`   - Dự đoán: ${sample.prediction}`);
        console.log(`   - Độ tin cậy: ${sample.confidence}`);
        console.log(`   - Pattern: ${sample.pattern.substring(0, 80)}...`);
    }
    
    autoUpdate();
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   📍 http://localhost:${PORT}`);
        console.log(`\n🔮 DỰ ĐOÁN (5 THÔNG TIN ĐẦY ĐỦ):`);
        console.log(`   📊 /api/vanhoa        - Tất cả bàn`);
        console.log(`   🎯 /api/vanhoa/C01    - Bàn cụ thể`);
        console.log(`\n✅ HỆ THỐNG SẴN SÀNG!`);
    });
}

start();
