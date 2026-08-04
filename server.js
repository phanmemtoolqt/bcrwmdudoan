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
let predictions = [];
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
            
            // Tự động tính toán dự đoán sau khi cập nhật dữ liệu
            calculatePredictions();
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

// Phân tích pattern cầu Baccarat
function analyzePattern(result) {
    if (!result || result.length < 5) return null;
    
    const cleanResult = result.replace(/T/g, ''); // Bỏ qua T (Tie)
    if (cleanResult.length < 5) return null;
    
    const patterns = [];
    const lastResults = cleanResult.slice(-20); // Lấy 20 kết quả gần nhất
    
    // 1. Pattern cầu bệt (streak)
    const streakPattern = detectStreak(lastResults);
    if (streakPattern) patterns.push(streakPattern);
    
    // 2. Pattern cầu 1-1 (zigzag)
    const zigzagPattern = detectZigzag(lastResults);
    if (zigzagPattern) patterns.push(zigzagPattern);
    
    // 3. Pattern cầu 2-2
    const doublePattern = detectDoublePattern(lastResults);
    if (doublePattern) patterns.push(doublePattern);
    
    // 4. Pattern cầu 3-3
    const triplePattern = detectTriplePattern(lastResults);
    if (triplePattern) patterns.push(triplePattern);
    
    // 5. Pattern cầu nghiêng (bên này nhiều hơn)
    const biasPattern = detectBias(lastResults);
    if (biasPattern) patterns.push(biasPattern);
    
    // 6. Pattern đảo chiều (reversal)
    const reversalPattern = detectReversal(lastResults);
    if (reversalPattern) patterns.push(reversalPattern);
    
    // Tổng hợp dự đoán
    if (patterns.length === 0) return null;
    
    // Đếm số lần dự đoán B và P
    let bCount = 0;
    let pCount = 0;
    let totalConfidence = 0;
    
    patterns.forEach(p => {
        totalConfidence += p.confidence;
        if (p.prediction === 'B') bCount += p.weight;
        else pCount += p.weight;
    });
    
    // Tính độ tin cậy trung bình
    const avgConfidence = Math.min(100, Math.round(totalConfidence / patterns.length));
    
    // Quyết định dự đoán cuối cùng
    let finalPrediction;
    if (bCount > pCount) finalPrediction = 'B';
    else if (pCount > bCount) finalPrediction = 'P';
    else finalPrediction = Math.random() > 0.5 ? 'B' : 'P'; // Random nếu bằng
    
    // Số phiên dự đoán
    const patternCount = patterns.length;
    const sessionNumber = cleanResult.length + 1;
    
    return {
        prediction: finalPrediction,
        confidence: avgConfidence,
        patterns: patterns.map(p => ({
            name: p.name,
            prediction: p.prediction,
            confidence: p.confidence
        })),
        totalPatterns: patternCount,
        sessionNumber: sessionNumber
    };
}

// Phát hiện cầu bệt (streak)
function detectStreak(results) {
    const last3 = results.slice(-3);
    if (last3.length < 3) return null;
    
    const allB = last3.every(r => r === 'B');
    const allP = last3.every(r => r === 'P');
    
    if (allB) {
        const streakLength = getStreakLength(results, 'B');
        return {
            name: 'Cầu bệt Banker',
            prediction: 'B',
            confidence: Math.min(95, 60 + streakLength * 5),
            weight: 2
        };
    }
    if (allP) {
        const streakLength = getStreakLength(results, 'P');
        return {
            name: 'Cầu bệt Player',
            prediction: 'P',
            confidence: Math.min(95, 60 + streakLength * 5),
            weight: 2
        };
    }
    return null;
}

// Đếm độ dài streak
function getStreakLength(results, side) {
    let count = 0;
    for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === side) count++;
        else break;
    }
    return count;
}

// Phát hiện cầu zigzag (1-1)
function detectZigzag(results) {
    const last4 = results.slice(-4);
    if (last4.length < 4) return null;
    
    const pattern1 = ['B', 'P', 'B', 'P'];
    const pattern2 = ['P', 'B', 'P', 'B'];
    
    const match1 = last4.every((r, i) => r === pattern1[i]);
    const match2 = last4.every((r, i) => r === pattern2[i]);
    
    if (match1) {
        return {
            name: 'Cầu 1-1 (B-P-B-P)',
            prediction: 'B',
            confidence: 75,
            weight: 1.5
        };
    }
    if (match2) {
        return {
            name: 'Cầu 1-1 (P-B-P-B)',
            prediction: 'P',
            confidence: 75,
            weight: 1.5
        };
    }
    return null;
}

// Phát hiện cầu 2-2
function detectDoublePattern(results) {
    const last8 = results.slice(-8);
    if (last8.length < 8) return null;
    
    const pattern1 = ['B', 'B', 'P', 'P', 'B', 'B', 'P', 'P'];
    const pattern2 = ['P', 'P', 'B', 'B', 'P', 'P', 'B', 'B'];
    
    const match1 = last8.every((r, i) => r === pattern1[i]);
    const match2 = last8.every((r, i) => r === pattern2[i]);
    
    if (match1) {
        return {
            name: 'Cầu 2-2 (BB-PP-BB-PP)',
            prediction: 'B',
            confidence: 80,
            weight: 2
        };
    }
    if (match2) {
        return {
            name: 'Cầu 2-2 (PP-BB-PP-BB)',
            prediction: 'P',
            confidence: 80,
            weight: 2
        };
    }
    return null;
}

// Phát hiện cầu 3-3
function detectTriplePattern(results) {
    const last12 = results.slice(-12);
    if (last12.length < 12) return null;
    
    const pattern1 = ['B', 'B', 'B', 'P', 'P', 'P', 'B', 'B', 'B', 'P', 'P', 'P'];
    const pattern2 = ['P', 'P', 'P', 'B', 'B', 'B', 'P', 'P', 'P', 'B', 'B', 'B'];
    
    const match1 = last12.every((r, i) => r === pattern1[i]);
    const match2 = last12.every((r, i) => r === pattern2[i]);
    
    if (match1) {
        return {
            name: 'Cầu 3-3 (BBB-PPP-BBB-PPP)',
            prediction: 'B',
            confidence: 85,
            weight: 2.5
        };
    }
    if (match2) {
        return {
            name: 'Cầu 3-3 (PPP-BBB-PPP-BBB)',
            prediction: 'P',
            confidence: 85,
            weight: 2.5
        };
    }
    return null;
}

// Phát hiện bias (nghiêng về 1 bên)
function detectBias(results) {
    if (results.length < 10) return null;
    
    const recentResults = results.slice(-15);
    const bCount = recentResults.filter(r => r === 'B').length;
    const pCount = recentResults.filter(r => r === 'P').length;
    const total = bCount + pCount;
    
    const bRatio = (bCount / total) * 100;
    const pRatio = (pCount / total) * 100;
    
    if (bRatio >= 65) {
        return {
            name: `Cầu nghiêng Banker (${bRatio.toFixed(0)}%)`,
            prediction: 'B',
            confidence: Math.min(90, bRatio),
            weight: 1.5
        };
    }
    if (pRatio >= 65) {
        return {
            name: `Cầu nghiêng Player (${pRatio.toFixed(0)}%)`,
            prediction: 'P',
            confidence: Math.min(90, pRatio),
            weight: 1.5
        };
    }
    return null;
}

// Phát hiện đảo chiều
function detectReversal(results) {
    if (results.length < 6) return null;
    
    const last = results[results.length - 1];
    const prev3 = results.slice(-4, -1);
    
    const allSame = prev3.every(r => r === prev3[0]);
    
    if (allSame && prev3[0] !== last) {
        return {
            name: `Đảo chiều từ ${prev3[0]} sang ${last}`,
            prediction: last,
            confidence: 65,
            weight: 1
        };
    }
    return null;
}

// Tính toán dự đoán cho tất cả bàn
function calculatePredictions() {
    predictions = [];
    
    baccaratData.forEach(table => {
        const analysis = analyzePattern(table.result);
        if (analysis) {
            predictions.push({
                table: table.table,
                session: analysis.sessionNumber,
                prediction: analysis.prediction,
                confidence: analysis.confidence,
                patterns: analysis.patterns,
                totalPatterns: analysis.totalPatterns,
                resultHistory: table.result.slice(-10) // 10 kết quả gần nhất
            });
        }
    });
    
    // Sắp xếp theo độ tin cậy giảm dần
    predictions.sort((a, b) => b.confidence - a.confidence);
}

// ======================
// VÒNG LẶP TỰ ĐỘNG CẬP NHẬT
// ======================
async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        console.log(`[${new Date().toLocaleTimeString()}] Đã cập nhật ${predictions.length} dự đoán`);
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
        data: predictions,
        lastUpdate: lastUpdate,
        total: predictions.length
    });
});

// API dự đoán cho bàn cụ thể
app.get('/api/predictions/:table', (req, res) => {
    const tableName = req.params.table;
    const prediction = predictions.find(p => p.table === tableName);
    
    if (prediction) {
        res.json({
            success: true,
            table: prediction.table,
            session: prediction.session,
            prediction: prediction.prediction,
            confidence: prediction.confidence,
            patterns: prediction.patterns,
            totalPatterns: prediction.totalPatterns,
            resultHistory: prediction.resultHistory
        });
    } else {
        res.json({ 
            success: false, 
            message: 'Không có dữ liệu dự đoán cho bàn ' + tableName 
        });
    }
});

// API top dự đoán có độ tin cậy cao nhất
app.get('/api/predictions/top/:limit', (req, res) => {
    const limit = parseInt(req.params.limit) || 5;
    const topPredictions = predictions.slice(0, limit);
    
    res.json({
        success: true,
        data: topPredictions,
        lastUpdate: lastUpdate
    });
});

// API thống kê dự đoán
app.get('/api/statistics', (req, res) => {
    const stats = {
        totalTables: baccaratData.length,
        totalPredictions: predictions.length,
        avgConfidence: predictions.length > 0 
            ? Math.round(predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length) 
            : 0,
        highConfidence: predictions.filter(p => p.confidence >= 80).length,
        mediumConfidence: predictions.filter(p => p.confidence >= 60 && p.confidence < 80).length,
        lowConfidence: predictions.filter(p => p.confidence < 60).length,
        lastUpdate: lastUpdate
    };
    
    res.json({ success: true, data: stats });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT PREDICTION API SERVER');
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
    
    console.log('[3] Lấy dữ liệu và tính toán dự đoán...');
    await fetchBaccaratData();
    console.log(`[OK] Đã lấy ${baccaratData.length} bàn, ${predictions.length} dự đoán`);
    
    // Hiển thị top dự đoán
    console.log('\n📊 TOP DỰ ĐOÁN CÓ ĐỘ TIN CẬY CAO:');
    predictions.slice(0, 10).forEach(p => {
        const predictionIcon = p.prediction === 'B' ? '🔴' : '🔵';
        console.log(`   ${predictionIcon} Bàn ${p.table.padEnd(4)} | Phiên ${p.session.toString().padStart(3)} | Dự đoán: ${p.prediction} | Độ tin cậy: ${p.confidence}% | Patterns: ${p.totalPatterns}`);
    });
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`\n📡 LỊCH SỬ:`);
        console.log(`   http://localhost:${PORT}/api/baccarat`);
        console.log(`   http://localhost:${PORT}/api/baccarat/:table`);
        console.log(`   http://localhost:${PORT}/api/latest`);
        console.log(`\n🎯 DỰ ĐOÁN:`);
        console.log(`   http://localhost:${PORT}/api/predictions`);
        console.log(`   http://localhost:${PORT}/api/predictions/:table`);
        console.log(`   http://localhost:${PORT}/api/predictions/top/5`);
        console.log(`\n📊 THỐNG KÊ:`);
        console.log(`   http://localhost:${PORT}/api/statistics`);
        console.log(`\n⏰ Auto update mỗi 2 giây`);
    });
}

start();
