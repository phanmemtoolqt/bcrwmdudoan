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

const agent = new https.Agent({ 
    rejectUnauthorized: false,
    keepAlive: true,
    keepAliveMsecs: 1000
});

let cookieJar = '';
let baccaratData = [];
let predictionData = [];
let lastUpdate = null;

// ======================
// SESSION AXIOS TỐI ƯU
// ======================
const session = axios.create({
    baseURL: BASE,
    timeout: 10000, // Giảm timeout xuống 10s
    httpsAgent: agent,
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    }
});

// Interceptor lưu cookie nhanh hơn
session.interceptors.request.use(config => {
    if (cookieJar) config.headers.Cookie = cookieJar;
    return config;
});

session.interceptors.response.use(res => {
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
        const cookies = setCookie.map(c => c.split(';')[0]).join('; ');
        cookieJar = cookies + (cookieJar ? '; ' + cookieJar : '');
    }
    return res;
});

// ======================
// LẤY CSRF TOKEN NHANH
// ======================
function getCsrfToken(html) {
    const match = html.match(/csrf-token"[^>]+content="([^"]+)/);
    return match ? match[1] : null;
}

// ======================
// ĐĂNG NHẬP NHANH
// ======================
async function login() {
    try {
        const [getResp] = await Promise.all([
            session.get(LOGIN_URL)
        ]);
        
        const token = getCsrfToken(getResp.data);
        if (!token) throw new Error('Không lấy được CSRF token');
        
        const formData = `username=${USERNAME}&password=${PASSWORD}&_token=${token}&action=Login`;
        
        const loginResp = await session.post(LOGIN_URL, formData, {
            headers: {
                'Referer': LOGIN_URL,
                'Origin': BASE,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        return loginResp.status === 200;
    } catch (error) {
        console.error('Login error:', error.message);
        return false;
    }
}

// ======================
// VÀO LOBBY NHANH
// ======================
async function goToLobby() {
    try {
        await session.get(LOBBY_URL, { timeout: 5000 });
        return true;
    } catch (error) {
        console.error('Lobby error:', error.message);
        return false;
    }
}

// ======================
// LẤY KẾT QUẢ BACCARAT SIÊU NHANH
// ======================
async function fetchBaccaratData() {
    try {
        let xsrfToken = '';
        const xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xsrfMatch) xsrfToken = decodeURIComponent(xsrfMatch[1]);
        
        const resp = await session.post(GETNEWRESULT_URL, 'gameCode=ae', {
            headers: {
                'Referer': LOBBY_URL,
                'Origin': BASE,
                'X-Requested-With': 'XMLHttpRequest',
                'X-XSRF-TOKEN': xsrfToken,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            timeout: 5000
        });
        
        if (resp.data && resp.data.data) {
            baccaratData = resp.data.data.map(item => ({
                table: item.table_name,
                result: item.result,
                shoeId: item.shoeId || '',
                round: item.round || ''
            }));
            lastUpdate = new Date().toISOString();
            
            // Cập nhật dự đoán ngay lập tức
            updatePredictions();
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

// ======================
// THUẬT TOÁN DỰ ĐOÁN NÂNG CAO
// ======================
function analyzePatterns(result) {
    // Loại bỏ ký tự 'T' (Tie)
    const cleanResult = result.replace(/T/g, '');
    const patterns = [];
    let totalWeight = 0;
    
    if (cleanResult.length < 3) {
        return { 
            prediction: 'Không đủ dữ liệu', 
            confidence: 0, 
            patterns: [], 
            nextRound: cleanResult.length + 1,
            totalPatternScore: 0
        };
    }
    
    const recentResults = cleanResult.slice(-30); // Tăng lên 30 kết quả để phân tích
    
    // ===== PHÂN TÍCH CHI TIẾT =====
    
    // 1. Cầu Bệt (Streak) - Trọng số 10
    const streak = analyzeStreak(recentResults);
    if (streak) {
        patterns.push(streak);
        totalWeight += streak.weight;
    }
    
    // 2. Cầu 1-1 (Ziczac) - Trọng số 9
    const ziczac = analyzeZiczac(recentResults);
    if (ziczac) {
        patterns.push(ziczac);
        totalWeight += ziczac.weight;
    }
    
    // 3. Cầu 2-2 (Double Alternating) - Trọng số 8
    const doubleAlt = analyzeDoubleAlternating(recentResults);
    if (doubleAlt) {
        patterns.push(doubleAlt);
        totalWeight += doubleAlt.weight;
    }
    
    // 4. Cầu 3-3 (Triple Alternating) - Trọng số 7
    const tripleAlt = analyzeTripleAlternating(recentResults);
    if (tripleAlt) {
        patterns.push(tripleAlt);
        totalWeight += tripleAlt.weight;
    }
    
    // 5. Cầu Nghiêng (Bias) - Trọng số 6
    const bias = analyzeBias(recentResults);
    if (bias) {
        patterns.push(bias);
        totalWeight += bias.weight;
    }
    
    // 6. Pattern Đảo Chiều (Reversal) - Trọng số 5
    const reversal = analyzeReversal(recentResults);
    if (reversal) {
        patterns.push(reversal);
        totalWeight += reversal.weight;
    }
    
    // 7. Pattern Xác Suất Thống Kê - Trọng số 4
    const stats = analyzeStatistics(recentResults);
    if (stats) {
        patterns.push(stats);
        totalWeight += stats.weight;
    }
    
    // 8. Pattern Cầu 4-4 (Quad Alternating) - Trọng số 3
    const quadAlt = analyzeQuadAlternating(recentResults);
    if (quadAlt) {
        patterns.push(quadAlt);
        totalWeight += quadAlt.weight;
    }
    
    // ===== TÍNH TOÁN DỰ ĐOÁN CUỐI CÙNG =====
    let bankerScore = 0;
    let playerScore = 0;
    
    patterns.forEach(p => {
        if (p.prediction === 'B') {
            bankerScore += p.weight;
        } else if (p.prediction === 'P') {
            playerScore += p.weight;
        }
    });
    
    // Công thức dự đoán cải tiến
    let finalPrediction;
    let confidence;
    const totalScore = bankerScore + playerScore;
    
    if (totalScore > 0) {
        const bankerPercent = (bankerScore / totalScore) * 100;
        const playerPercent = (playerScore / totalScore) * 100;
        
        if (bankerScore > playerScore) {
            finalPrediction = 'Banker (B)';
            confidence = Math.min(92, Math.round(bankerPercent));
        } else if (playerScore > bankerScore) {
            finalPrediction = 'Player (P)';
            confidence = Math.min(92, Math.round(playerPercent));
        } else {
            // Tie-break với xác suất
            const totalB = (cleanResult.match(/B/g) || []).length;
            const totalP = (cleanResult.match(/P/g) || []).length;
            finalPrediction = totalB >= totalP ? 'Banker (B)' : 'Player (P)';
            confidence = 50;
        }
    } else {
        finalPrediction = 'Không xác định';
        confidence = 0;
    }
    
    // TÍNH PHIÊN DỰ ĐOÁN CHÍNH XÁC
    const currentRound = cleanResult.length;
    const patternCount = patterns.length;
    const nextRound = currentRound + 1; // Phiên dự đoán = tổng pattern + 1
    
    return {
        prediction: finalPrediction,
        confidence: confidence,
        patterns: patterns,
        currentRound: currentRound,
        nextRound: nextRound,
        totalPatternScore: totalScore
    };
}

// 1. Cầu Bệt cải tiến
function analyzeStreak(results) {
    let maxStreak = 0;
    let currentStreak = 1;
    let streakDirection = results[results.length - 1];
    
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === results[results.length - 1]) {
            currentStreak++;
        } else {
            break;
        }
    }
    
    if (currentStreak >= 3) {
        return {
            name: 'Cầu Bệt',
            detail: `${streakDirection} liên tiếp ${currentStreak} lần`,
            prediction: streakDirection,
            weight: 8 + currentStreak * 2
        };
    }
    return null;
}

// 2. Cầu 1-1 cải tiến
function analyzeZiczac(results) {
    let ziczacCount = 0;
    
    for (let i = results.length - 1; i > 0; i--) {
        if (results[i] !== results[i - 1]) {
            ziczacCount++;
        } else {
            break;
        }
    }
    
    if (ziczacCount >= 4) {
        const nextPrediction = results[results.length - 1] === 'B' ? 'P' : 'B';
        return {
            name: 'Cầu 1-1 (Ziczac)',
            detail: `So le ${ziczacCount + 1} lần`,
            prediction: nextPrediction,
            weight: 7 + ziczacCount * 2
        };
    }
    return null;
}

// 3. Cầu 2-2
function analyzeDoubleAlternating(results) {
    let doublePattern = 0;
    let i = results.length - 2;
    
    while (i >= 1) {
        if (results[i] === results[i+1] && results[i] !== results[i-1]) {
            doublePattern++;
            i -= 2;
        } else {
            break;
        }
    }
    
    if (doublePattern >= 2) {
        const lastChar = results[results.length - 1];
        const nextPrediction = results[results.length - 2] === results[results.length - 1] ? 
            (lastChar === 'B' ? 'P' : 'B') : lastChar;
        
        return {
            name: 'Cầu 2-2',
            detail: `Đôi một đổi bên ${doublePattern} lần`,
            prediction: nextPrediction,
            weight: 6 + doublePattern * 2
        };
    }
    return null;
}

// 4. Cầu 3-3
function analyzeTripleAlternating(results) {
    let triplePattern = 0;
    let i = results.length - 3;
    
    while (i >= 2) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2]) {
            if (i + 3 < results.length && results[i+3] !== results[i]) {
                triplePattern++;
                i -= 3;
            } else if (i === 0) {
                triplePattern++;
                break;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    
    if (triplePattern >= 1) {
        const lastThree = results.slice(-3);
        const nextPrediction = lastThree.every(c => c === 'B') ? 'P' : 'B';
        
        return {
            name: 'Cầu 3-3',
            detail: `Ba một đổi ${triplePattern} lần`,
            prediction: nextPrediction,
            weight: 5 + triplePattern * 3
        };
    }
    return null;
}

// 5. Cầu Nghiêng
function analyzeBias(results) {
    const totalB = (results.match(/B/g) || []).length;
    const totalP = (results.match(/P/g) || []).length;
    const total = results.length;
    
    const bPercent = (totalB / total) * 100;
    const pPercent = (totalP / total) * 100;
    const diff = Math.abs(bPercent - pPercent);
    
    if (diff >= 12) {
        const biasDirection = bPercent > pPercent ? 'B' : 'P';
        return {
            name: 'Cầu Nghiêng',
            detail: `${biasDirection} chiếm ${Math.max(bPercent, pPercent).toFixed(1)}%`,
            prediction: biasDirection,
            weight: Math.floor(diff / 3)
        };
    }
    return null;
}

// 6. Pattern Đảo Chiều
function analyzeReversal(results) {
    const last10 = results.slice(-10);
    let changes = 0;
    
    for (let i = 1; i < last10.length; i++) {
        if (last10[i] !== last10[i-1]) changes++;
    }
    
    const changeRate = changes / 9;
    
    if (changeRate >= 0.7) {
        const lastChar = results[results.length - 1];
        return {
            name: 'Đảo Chiều Cao',
            detail: `Tỷ lệ đảo ${(changeRate * 100).toFixed(0)}%`,
            prediction: lastChar === 'B' ? 'P' : 'B',
            weight: 5
        };
    }
    return null;
}

// 7. Xác Suất Thống Kê
function analyzeStatistics(results) {
    const last6 = results.slice(-6);
    const patternMap = {};
    
    for (let i = 0; i < last6.length - 1; i++) {
        const pattern = last6[i] + last6[i+1];
        patternMap[pattern] = (patternMap[pattern] || 0) + 1;
    }
    
    const mostCommon = Object.entries(patternMap).sort((a, b) => b[1] - a[1])[0];
    
    if (mostCommon && mostCommon[1] >= 2) {
        return {
            name: 'Xác Suất Lặp',
            detail: `Pattern ${mostCommon[0]} xuất hiện ${mostCommon[1]} lần`,
            prediction: mostCommon[0][1],
            weight: 4
        };
    }
    return null;
}

// 8. Cầu 4-4
function analyzeQuadAlternating(results) {
    let quadPattern = 0;
    let i = results.length - 4;
    
    while (i >= 3) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2] && results[i+2] === results[i+3]) {
            quadPattern++;
            i -= 4;
        } else {
            break;
        }
    }
    
    if (quadPattern >= 1) {
        const lastFour = results.slice(-4);
        const nextPrediction = lastFour.every(c => c === 'B') ? 'P' : 'B';
        
        return {
            name: 'Cầu 4-4',
            detail: `Bốn một đổi ${quadPattern} lần`,
            prediction: nextPrediction,
            weight: 3 + quadPattern * 4
        };
    }
    return null;
}

// Cập nhật dự đoán
function updatePredictions() {
    predictionData = baccaratData.map(item => {
        const analysis = analyzePatterns(item.result);
        
        return {
            table: item.table,
            currentRound: analysis.currentRound,
            nextRound: analysis.nextRound, // Phiên dự đoán = tổng pattern + 1
            prediction: analysis.prediction,
            confidence: analysis.confidence + '%',
            patterns: analysis.patterns.map(p => ({
                name: p.name,
                detail: p.detail,
                prediction: p.prediction === 'B' ? 'Banker' : 'Player',
                weight: p.weight
            })),
            totalPatterns: analysis.patterns.length,
            totalWeight: analysis.totalPatternScore,
            result: item.result.slice(-30) // Kết quả 30 phiên gần nhất
        };
    });
}

// ======================
// VÒNG LẶP TỰ ĐỘNG CẬP NHẬT SIÊU NHANH
// ======================
async function autoUpdate() {
    while (true) {
        try {
            await fetchBaccaratData();
            console.log(`[${new Date().toLocaleTimeString()}] Cập nhật: ${baccaratData.length} bàn - ${predictionData.length} dự đoán`);
        } catch (error) {
            console.error('Update error:', error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1500)); // Giảm xuống 1.5s
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

// ======================
// API LỊCH SỬ
// ======================
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate,
        total: baccaratData.length
    });
});

app.get('/api/baccarat/:table', (req, res) => {
    const found = baccaratData.find(item => item.table === req.params.table);
    found ? res.json({ success: true, data: found }) 
          : res.json({ success: false, message: 'Không tìm thấy bàn ' + req.params.table });
});

app.get('/api/latest', (req, res) => {
    const latest = [...baccaratData]
        .sort((a, b) => (parseInt(b.table) || 999) - (parseInt(a.table) || 999))
        .slice(0, 10);
    res.json({ success: true, data: latest, lastUpdate });
});

// ======================
// API DỰ ĐOÁN
// ======================
app.get('/api/predictions', (req, res) => {
    res.json({
        success: true,
        data: predictionData,
        lastUpdate,
        total: predictionData.length
    });
});

app.get('/api/predictions/:table', (req, res) => {
    const found = predictionData.find(item => item.table === req.params.table);
    found ? res.json({ success: true, data: found }) 
          : res.json({ success: false, message: 'Không tìm thấy bàn ' + req.params.table });
});

app.get('/api/predictions/top/:limit', (req, res) => {
    const limit = parseInt(req.params.limit) || 5;
    const sorted = [...predictionData]
        .filter(p => p.confidence !== '0%')
        .sort((a, b) => parseInt(b.confidence) - parseInt(a.confidence))
        .slice(0, limit);
    
    res.json({
        success: true,
        data: sorted,
        message: `Top ${limit} dự đoán có độ tin cậy cao nhất`,
        lastUpdate
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('🚀 BACCARAT API - PHIÊN BẢN TỐC ĐỘ CAO');
    console.log('========================================\n');
    
    console.log('⚡ Đang đăng nhập...');
    if (!await login()) {
        console.error('❌ Đăng nhập thất bại!');
        process.exit(1);
    }
    console.log('✅ Đăng nhập thành công');
    
    console.log('⚡ Vào lobby...');
    await goToLobby();
    console.log('✅ Vào lobby thành công\n');
    
    console.log('⚡ Lấy dữ liệu...');
    await fetchBaccaratData();
    console.log(`✅ Đã lấy ${baccaratData.length} bàn\n`);
    
    // Hiển thị dự đoán
    console.log('🎯 DỰ ĐOÁN CHI TIẾT:\n');
    predictionData.slice(0, 5).forEach(item => {
        console.log(`📊 Bàn ${item.table}:`);
        console.log(`   Phiên hiện tại: ${item.currentRound}`);
        console.log(`   Phiên dự đoán: ${item.nextRound} (${item.totalPatterns} pattern + 1)`);
        console.log(`   Dự đoán: ${item.prediction}`);
        console.log(`   Độ tin cậy: ${item.confidence}`);
        console.log(`   Pattern phát hiện:`);
        item.patterns.forEach(p => {
            console.log(`     • ${p.name}: ${p.detail} (trọng số: ${p.weight})`);
        });
        console.log('');
    });
    
    // Chạy auto update
    autoUpdate();
    
    const PORT = 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log('🌐 API ENDPOINTS:');
        console.log(`   📜 Lịch sử: http://localhost:${PORT}/api/baccarat`);
        console.log(`   🔮 Dự đoán: http://localhost:${PORT}/api/predictions`);
        console.log(`   🎯 Top dự đoán: http://localhost:${PORT}/api/predictions/top/5`);
        console.log(`\n⚡ Tốc độ cập nhật: 1.5 giây/lần`);
    });
}

start();
