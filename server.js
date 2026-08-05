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
let predictionData = [];
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
            
            // Cập nhật dự đoán
            updatePredictions();
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

// ======================
// THUẬT TOÁN DỰ ĐOÁN BACCARAT
// ======================
function analyzePatterns(result) {
    const patterns = [];
    let totalWeight = 0;
    
    // Loại bỏ ký tự 'T' (Tie) khỏi kết quả để phân tích
    const cleanResult = result.replace(/T/g, '');
    
    if (cleanResult.length < 3) {
        return { prediction: 'Không đủ dữ liệu', confidence: 0, patterns: [], nextRound: 1 };
    }
    
    // Lấy 20 kết quả gần nhất để phân tích
    const recentResults = cleanResult.slice(-20);
    const lastResult = cleanResult.slice(-1);
    
    // 1. Pattern Cầu Bệt (Streak) - trọng số cao nhất
    const streakPattern = analyzeStreak(recentResults);
    if (streakPattern) {
        patterns.push(streakPattern);
        totalWeight += streakPattern.weight;
    }
    
    // 2. Pattern Cầu 1-1 (Ziczac/Single)
    const ziczacPattern = analyzeZiczac(recentResults);
    if (ziczacPattern) {
        patterns.push(ziczacPattern);
        totalWeight += ziczacPattern.weight;
    }
    
    // 3. Pattern Cầu 2-2
    const doublePattern = analyzeDouble(recentResults);
    if (doublePattern) {
        patterns.push(doublePattern);
        totalWeight += doublePattern.weight;
    }
    
    // 4. Pattern Cầu 3-3
    const triplePattern = analyzeTriple(recentResults);
    if (triplePattern) {
        patterns.push(triplePattern);
        totalWeight += triplePattern.weight;
    }
    
    // 5. Pattern Cầu Nghiêng (một bên)
    const biasPattern = analyzeBias(recentResults);
    if (biasPattern) {
        patterns.push(biasPattern);
        totalWeight += biasPattern.weight;
    }
    
    // Tính toán dự đoán cuối cùng
    let bankerVotes = 0;
    let playerVotes = 0;
    
    patterns.forEach(p => {
        if (p.prediction === 'B') {
            bankerVotes += p.weight;
        } else if (p.prediction === 'P') {
            playerVotes += p.weight;
        }
    });
    
    let finalPrediction;
    let confidence;
    
    if (bankerVotes > playerVotes) {
        finalPrediction = 'Banker (B)';
        confidence = Math.min(95, Math.round((bankerVotes / totalWeight) * 100));
    } else if (playerVotes > bankerVotes) {
        finalPrediction = 'Player (P)';
        confidence = Math.min(95, Math.round((playerVotes / totalWeight) * 100));
    } else {
        // Hòa vote - dùng xác suất thống kê
        const totalGames = cleanResult.length;
        const bankerCount = (cleanResult.match(/B/g) || []).length;
        const playerCount = (cleanResult.match(/P/g) || []).length;
        
        if (bankerCount > playerCount) {
            finalPrediction = 'Banker (B)';
            confidence = 55;
        } else if (playerCount > bankerCount) {
            finalPrediction = 'Player (P)';
            confidence = 55;
        } else {
            finalPrediction = 'Banker (B) - Không chắc chắn';
            confidence = 50;
        }
    }
    
    // Xác định phiên dự đoán tiếp theo
    const currentRound = cleanResult.length;
    const nextRound = currentRound + 1;
    
    return {
        prediction: finalPrediction,
        confidence: confidence,
        patterns: patterns,
        nextRound: nextRound
    };
}

// Phân tích cầu bệt (Streak)
function analyzeStreak(results) {
    const lastResults = results.slice(-5);
    let streakCount = 1;
    const streakDirection = lastResults[lastResults.length - 1];
    
    for (let i = lastResults.length - 2; i >= 0; i--) {
        if (lastResults[i] === streakDirection) {
            streakCount++;
        } else {
            break;
        }
    }
    
    if (streakCount >= 3) {
        return {
            name: 'Cầu Bệt',
            detail: `${streakDirection} liên tiếp ${streakCount} lần`,
            prediction: streakDirection,
            weight: 8 + streakCount // Bệt càng dài trọng số càng cao
        };
    }
    return null;
}

// Phân tích cầu 1-1 (Ziczac)
function analyzeZiczac(results) {
    const lastResults = results.slice(-5);
    let ziczacCount = 0;
    
    for (let i = lastResults.length - 1; i > 0; i--) {
        if (lastResults[i] !== lastResults[i - 1]) {
            ziczacCount++;
        } else {
            break;
        }
    }
    
    if (ziczacCount >= 3) {
        const nextPrediction = lastResults[lastResults.length - 1] === 'B' ? 'P' : 'B';
        return {
            name: 'Cầu 1-1 (Ziczac)',
            detail: `So le ${ziczacCount + 1} lần liên tiếp`,
            prediction: nextPrediction,
            weight: 7 + ziczacCount
        };
    }
    return null;
}

// Phân tích cầu 2-2
function analyzeDouble(results) {
    const lastResults = results.slice(-6);
    let pattern = [];
    
    // Nhóm thành các cặp
    for (let i = 0; i < lastResults.length - 1; i += 2) {
        if (lastResults[i] === lastResults[i + 1]) {
            pattern.push(lastResults[i] + lastResults[i + 1]);
        } else {
            break;
        }
    }
    
    if (pattern.length >= 2) {
        const lastPair = pattern[pattern.length - 1];
        const nextPrediction = lastPair[0] === 'B' ? 'P' : 'B';
        return {
            name: 'Cầu 2-2',
            detail: `Mỗi bên ${2} lần, đã lặp ${pattern.length} lần`,
            prediction: nextPrediction,
            weight: 6 + pattern.length
        };
    }
    return null;
}

// Phân tích cầu 3-3
function analyzeTriple(results) {
    const lastResults = results.slice(-9);
    let tripleCount = 0;
    let currentStreak = 1;
    let streakType = lastResults[lastResults.length - 1];
    
    for (let i = lastResults.length - 2; i >= 0; i--) {
        if (lastResults[i] === streakType) {
            currentStreak++;
        } else {
            if (currentStreak === 3) tripleCount++;
            currentStreak = 1;
            streakType = lastResults[i];
        }
    }
    
    if (tripleCount >= 2 && currentStreak < 3) {
        return {
            name: 'Cầu 3-3',
            detail: `Mỗi bên ${3} lần, đã xuất hiện ${tripleCount} lần`,
            prediction: lastResults[lastResults.length - 1],
            weight: 5 + tripleCount
        };
    }
    return null;
}

// Phân tích cầu nghiêng (Bias)
function analyzeBias(results) {
    const totalB = (results.match(/B/g) || []).length;
    const totalP = (results.match(/P/g) || []).length;
    const total = results.length;
    
    const bPercent = (totalB / total) * 100;
    const pPercent = (totalP / total) * 100;
    
    if (Math.abs(bPercent - pPercent) >= 15) {
        const biasDirection = bPercent > pPercent ? 'B' : 'P';
        const biasPercent = Math.max(bPercent, pPercent);
        return {
            name: 'Cầu Nghiêng',
            detail: `${biasDirection} chiếm ${biasPercent.toFixed(1)}% (tổng ${total} kết quả)`,
            prediction: biasDirection,
            weight: 4
        };
    }
    return null;
}

// Cập nhật tất cả dự đoán
function updatePredictions() {
    predictionData = baccaratData.map(item => {
        const analysis = analyzePatterns(item.result);
        const currentRound = item.result.replace(/T/g, '').length;
        
        return {
            table: item.table,
            currentRound: currentRound,
            nextRound: analysis.nextRound,
            prediction: analysis.prediction,
            confidence: analysis.confidence + '%',
            patterns: analysis.patterns.map(p => ({
                name: p.name,
                detail: p.detail,
                prediction: p.prediction
            })),
            totalPatterns: analysis.patterns.length,
            result: item.result.slice(-20) // Kết quả gần nhất
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

// CORS cho phép gọi từ frontend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// ======================
// API LỊCH SỬ
// ======================
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
// API DỰ ĐOÁN
// ======================
// API lấy tất cả dự đoán
app.get('/api/predictions', (req, res) => {
    res.json({
        success: true,
        data: predictionData,
        lastUpdate: lastUpdate,
        total: predictionData.length
    });
});

// API lấy dự đoán theo bàn
app.get('/api/predictions/:table', (req, res) => {
    const tableName = req.params.table;
    const found = predictionData.find(item => item.table === tableName);
    
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

// API lấy top dự đoán có độ tin cậy cao nhất
app.get('/api/predictions/top/:limit', (req, res) => {
    const limit = parseInt(req.params.limit) || 5;
    const sorted = [...predictionData]
        .sort((a, b) => {
            const confA = parseInt(a.confidence);
            const confB = parseInt(b.confidence);
            return confB - confA;
        })
        .slice(0, limit);
    
    res.json({
        success: true,
        data: sorted,
        message: `Top ${limit} dự đoán có độ tin cậy cao nhất`,
        lastUpdate: lastUpdate
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER - LỊCH SỬ & DỰ ĐOÁN');
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
    
    // Hiển thị dự đoán mẫu
    console.log('\n📊 DỰ ĐOÁN MẪU (5 bàn đầu tiên):');
    predictionData.slice(0, 5).forEach(item => {
        console.log(`\n   Bàn ${item.table}:`);
        console.log(`   - Phiên hiện tại: ${item.currentRound}`);
        console.log(`   - Phiên dự đoán: ${item.nextRound}`);
        console.log(`   - Dự đoán: ${item.prediction}`);
        console.log(`   - Độ tin cậy: ${item.confidence}`);
        console.log(`   - Số pattern phát hiện: ${item.totalPatterns}`);
        item.patterns.forEach(p => {
            console.log(`     + ${p.name}: ${p.detail} -> Dự đoán: ${p.prediction}`);
        });
    });
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`\n📜 LỊCH SỬ:`);
        console.log(`   http://localhost:${PORT}/api/baccarat`);
        console.log(`   http://localhost:${PORT}/api/baccarat/1`);
        console.log(`   http://localhost:${PORT}/api/latest`);
        console.log(`\n🔮 DỰ ĐOÁN:`);
        console.log(`   http://localhost:${PORT}/api/predictions`);
        console.log(`   http://localhost:${PORT}/api/predictions/1`);
        console.log(`   http://localhost:${PORT}/api/predictions/top/5`);
        console.log(`\n⏰ Auto update mỗi 2 giây`);
    });
}

start();
