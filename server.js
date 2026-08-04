const axios = require('axios');
const express = require('express');
const https = require('https');

// ======================
// CẤU HÌNH
// ======================
const BASE = "https://autobcr.com";
const LOGIN_URL = BASE + "/login";
const LOBBY_URL = BASE + "/wm/lobby";
const GETNEWRESULT_URL = BASE + "/baccarat/getnewresult";

const USERNAME = "bucumh";
const PASSWORD = "123456";

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;
let predictionData = [];

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

session.interceptors.request.use(function(config) {
    if (cookieJar) config.headers.Cookie = cookieJar;
    return config;
});

session.interceptors.response.use(function(res) {
    var setCookie = res.headers['set-cookie'];
    if (setCookie) {
        for (var i = 0; i < setCookie.length; i++) {
            var cookie = setCookie[i];
            var parts = cookie.split(';')[0].split('=');
            var name = parts[0];
            var value = parts[1];
            if (cookieJar.indexOf(name + '=') !== -1) {
                cookieJar = cookieJar.replace(new RegExp(name + '=[^;]+;?'), '');
            }
            cookieJar += name + '=' + value + '; ';
        }
    }
    return res;
});

// ======================
// LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    var match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

// ======================
// ĐĂNG NHẬP
// ======================
async function login() {
    try {
        var getResp = await session.get(LOGIN_URL);
        var token = getCsrfToken(getResp.data);
        var formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        formData.append('_token', token);
        formData.append('action', 'Login');
        var headers = { 'Referer': LOGIN_URL, 'Origin': BASE, 'Content-Type': 'application/x-www-form-urlencoded' };
        var loginResp = await session.post(LOGIN_URL, formData.toString(), { headers: headers });
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
        var xsrfToken = '';
        var xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xsrfMatch) xsrfToken = decodeURIComponent(xsrfMatch[1]);
        var headers = {
            'Referer': LOBBY_URL,
            'Origin': BASE,
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        var formData = new URLSearchParams();
        formData.append('gameCode', 'ae');
        var resp = await session.post(GETNEWRESULT_URL, formData.toString(), { headers: headers });
        
        if (resp.data && resp.data.data) {
            baccaratData = resp.data.data.map(function(item) {
                // Lấy số pattern từ chuỗi result (VD: "B,P,B,P" -> 4 pattern)
                var resultStr = item.result || '';
                var rounds = resultStr.split(',').filter(function(r) { 
                    return r.trim() !== '' && (r.trim() === 'B' || r.trim() === 'P' || r.trim() === 'T');
                });
                var totalPatterns = rounds.length;
                
                // Log để debug
                console.log('Bàn ' + item.table_name + ': result="' + resultStr + '" -> ' + totalPatterns + ' patterns');
                
                return {
                    table: item.table_name,
                    result: item.result,
                    round: item.round || '',
                    totalPatterns: totalPatterns
                };
            });
            lastUpdate = new Date().toISOString();
            updatePredictions();
        }
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
}

// ======================
// THUẬT TOÁN PHÂN TÍCH CHUỖI KẾT QUẢ
// ======================
function analyzeSequence(sequence) {
    var result = {
        length: sequence.length,
        bank: 0,
        player: 0,
        tie: 0,
        consecutiveB: 0,
        consecutiveP: 0,
        maxConsecutiveB: 0,
        maxConsecutiveP: 0,
        streaks: [],
        patterns: []
    };
    
    if (sequence.length === 0) return result;
    
    var currentStreak = 1;
    var currentType = sequence[0];
    
    for (var i = 0; i < sequence.length; i++) {
        if (sequence[i] === 'B') result.bank++;
        else if (sequence[i] === 'P') result.player++;
        else if (sequence[i] === 'T') result.tie++;
        
        if (i > 0) {
            if (sequence[i] === sequence[i-1]) {
                currentStreak++;
                if (sequence[i] === 'B' && currentStreak > result.maxConsecutiveB) {
                    result.maxConsecutiveB = currentStreak;
                }
                if (sequence[i] === 'P' && currentStreak > result.maxConsecutiveP) {
                    result.maxConsecutiveP = currentStreak;
                }
            } else {
                result.streaks.push({ type: currentType, length: currentStreak });
                currentStreak = 1;
                currentType = sequence[i];
            }
        }
    }
    result.streaks.push({ type: currentType, length: currentStreak });
    
    for (var i = 0; i < sequence.length - 3; i++) {
        var pattern = sequence.slice(i, i + 4);
        result.patterns.push(pattern.join(''));
    }
    
    return result;
}

// ======================
// THUẬT TOÁN DỰ ĐOÁN NÂNG CAO
// ======================
function advancedPrediction(history) {
    var rounds = history ? history.split(',').filter(function(r) { 
        return r.trim() !== '' && (r.trim() === 'B' || r.trim() === 'P' || r.trim() === 'T');
    }) : [];
    
    var analysis = {
        totalRounds: rounds.length,
        last10: rounds.slice(-10),
        last20: rounds.slice(-20),
        last30: rounds.slice(-30),
        last50: rounds.slice(-50),
        all: rounds
    };
    
    var stats10 = analyzeSequence(analysis.last10);
    var stats20 = analyzeSequence(analysis.last20);
    var stats30 = analyzeSequence(analysis.last30);
    var stats50 = analyzeSequence(analysis.last50);
    var statsAll = analyzeSequence(analysis.all);
    
    var predictions = [];
    var confidenceScores = [];
    
    // 1. PHÂN TÍCH CẦU BỆT
    if (rounds.length >= 3) {
        var last3 = rounds.slice(-3);
        if (last3.every(function(r) { return r === last3[0]; })) {
            var strength = 85;
            if (statsAll.maxConsecutiveB >= 5 || statsAll.maxConsecutiveP >= 5) strength = 90;
            if (statsAll.maxConsecutiveB >= 8 || statsAll.maxConsecutiveP >= 8) strength = 95;
            predictions.push({ type: 'Cầu bệt', value: last3[0], strength: strength });
            confidenceScores.push(strength);
        }
    }
    
    // 2. PHÂN TÍCH CẦU 1-1
    if (rounds.length >= 6) {
        var last6 = rounds.slice(-6);
        var check11 = true;
        for (var i = 0; i < last6.length - 1; i++) {
            if (last6[i] === last6[i+1]) {
                check11 = false;
                break;
            }
        }
        if (check11) {
            var strength = 75;
            var count = 0;
            for (var i = rounds.length - 1; i > 0; i--) {
                if (rounds[i] !== rounds[i-1]) count++;
                else break;
            }
            if (count >= 5) strength = 80;
            if (count >= 7) strength = 85;
            var lastChar = rounds[rounds.length - 1];
            var nextPredict = lastChar === 'B' ? 'P' : 'B';
            predictions.push({ type: 'Cầu 1-1', value: nextPredict, strength: strength });
            confidenceScores.push(strength);
        }
    }
    
    // 3. PHÂN TÍCH CẦU 2-2
    if (rounds.length >= 8) {
        var last8 = rounds.slice(-8);
        var check22 = true;
        for (var i = 0; i < last8.length - 2; i += 2) {
            if (last8[i] !== last8[i+1]) { check22 = false; break; }
            if (i + 2 < last8.length && last8[i] === last8[i+2]) { check22 = false; break; }
        }
        if (check22) {
            var strength = 70;
            var lastChar = rounds[rounds.length - 1];
            var nextPredict = lastChar === 'B' ? 'P' : 'B';
            predictions.push({ type: 'Cầu 2-2', value: nextPredict, strength: strength });
            confidenceScores.push(strength);
        }
    }
    
    // 4. PHÂN TÍCH CẦU 3-2
    if (rounds.length >= 10) {
        var last10 = rounds.slice(-10);
        var check32 = false;
        if (last10.length >= 5) {
            var last5 = last10.slice(-5);
            if (last5[0] === last5[1] && last5[1] === last5[2] && 
                last5[3] === last5[4] && last5[0] !== last5[3]) {
                check32 = true;
            }
        }
        if (check32) {
            var strength = 65;
            var lastChar = rounds[rounds.length - 1];
            var nextPredict = lastChar === 'B' ? 'P' : 'B';
            predictions.push({ type: 'Cầu 3-2', value: nextPredict, strength: strength });
            confidenceScores.push(strength);
        }
    }
    
    // 5. PHÂN TÍCH CẦU 2-3
    if (rounds.length >= 10) {
        var last10 = rounds.slice(-10);
        var check23 = false;
        if (last10.length >= 5) {
            var last5 = last10.slice(-5);
            if (last5[0] === last5[1] && last5[2] === last5[3] && 
                last5[3] === last5[4] && last5[0] !== last5[2]) {
                check23 = true;
            }
        }
        if (check23) {
            var strength = 65;
            var lastChar = rounds[rounds.length - 1];
            var nextPredict = lastChar;
            predictions.push({ type: 'Cầu 2-3', value: nextPredict, strength: strength });
            confidenceScores.push(strength);
        }
    }
    
    // 6. PHÂN TÍCH THỐNG KÊ XÁC SUẤT
    if (rounds.length >= 10) {
        var bCount = statsAll.bank;
        var pCount = statsAll.player;
        var tCount = statsAll.tie;
        var total = bCount + pCount + tCount;
        
        var bPercent = (bCount / total * 100);
        var pPercent = (pCount / total * 100);
        
        if (bPercent > 55) {
            predictions.push({ type: 'Xác suất cao', value: 'B', strength: Math.round(bPercent) });
            confidenceScores.push(Math.round(bPercent));
        } else if (pPercent > 55) {
            predictions.push({ type: 'Xác suất cao', value: 'P', strength: Math.round(pPercent) });
            confidenceScores.push(Math.round(pPercent));
        }
    }
    
    // 7. PHÂN TÍCH CHU KỲ
    var cycleAnalysis = {};
    if (rounds.length >= 20) {
        var cycleLength = 5;
        for (var c = 0; c < rounds.length - cycleLength; c++) {
            var cycle = rounds.slice(c, c + cycleLength);
            var key = cycle.join('');
            if (!cycleAnalysis[key]) cycleAnalysis[key] = 0;
            cycleAnalysis[key]++;
        }
        
        var maxCycle = '';
        var maxCount = 0;
        for (var key in cycleAnalysis) {
            if (cycleAnalysis[key] > maxCount) {
                maxCount = cycleAnalysis[key];
                maxCycle = key;
            }
        }
        
        if (maxCycle && maxCount >= 2) {
            var lastCycle = rounds.slice(-cycleLength);
            if (lastCycle.join('') === maxCycle) {
                var nextChar = maxCycle[maxCycle.length - 1] === 'B' ? 'P' : 'B';
                predictions.push({ type: 'Chu kỳ ' + maxCycle, value: nextChar, strength: 70 });
                confidenceScores.push(70);
            }
        }
    }
    
    // 8. PHÂN TÍCH BIẾN ĐỘNG
    if (rounds.length >= 15) {
        var recent = rounds.slice(-15);
        var bRecent = recent.filter(function(r) { return r === 'B'; }).length;
        var pRecent = recent.filter(function(r) { return r === 'P'; }).length;
        
        var bRate = bRecent / recent.length * 100;
        var pRate = pRecent / recent.length * 100;
        
        if (bRate > 70) {
            predictions.push({ type: 'Biến động B', value: 'P', strength: 60 });
            confidenceScores.push(60);
        } else if (pRate > 70) {
            predictions.push({ type: 'Biến động P', value: 'B', strength: 60 });
            confidenceScores.push(60);
        }
    }
    
    // 9. PHÂN TÍCH TREND
    if (rounds.length >= 12) {
        var trend = [];
        for (var i = 1; i < rounds.length; i++) {
            if (rounds[i] === rounds[i-1]) trend.push('Same');
            else trend.push('Change');
        }
        
        var sameCount = trend.filter(function(t) { return t === 'Same'; }).length;
        var changeCount = trend.filter(function(t) { return t === 'Change'; }).length;
        
        if (sameCount / trend.length > 0.7) {
            var lastChar = rounds[rounds.length - 1];
            predictions.push({ type: 'Trend Same', value: lastChar, strength: 75 });
            confidenceScores.push(75);
        } else if (changeCount / trend.length > 0.7) {
            var lastChar = rounds[rounds.length - 1];
            var nextChar = lastChar === 'B' ? 'P' : 'B';
            predictions.push({ type: 'Trend Change', value: nextChar, strength: 70 });
            confidenceScores.push(70);
        }
    }
    
    // 10. PHÂN TÍCH CÂN BẰNG
    if (rounds.length >= 20) {
        var totalB = statsAll.bank;
        var totalP = statsAll.player;
        var diff = Math.abs(totalB - totalP);
        
        if (diff > 10) {
            if (totalB > totalP) {
                predictions.push({ type: 'Cân bằng B', value: 'P', strength: 65 });
                confidenceScores.push(65);
            } else {
                predictions.push({ type: 'Cân bằng P', value: 'B', strength: 65 });
                confidenceScores.push(65);
            }
        }
    }
    
    // 11. PHÂN TÍCH MÔ HÌNH KẾT HỢP
    if (rounds.length >= 8) {
        var last4 = rounds.slice(-4);
        var pattern = last4.join('');
        var commonPatterns = ['BBBB', 'PPPP', 'BPBP', 'PBPB', 'BBPP', 'PPBB', 'BBBP', 'PPPB'];
        if (commonPatterns.indexOf(pattern) !== -1) {
            var nextChar = '';
            if (pattern === 'BBBB' || pattern === 'PPPP') {
                nextChar = pattern[0];
                predictions.push({ type: 'Mô hình ' + pattern, value: nextChar, strength: 80 });
                confidenceScores.push(80);
            } else if (pattern === 'BPBP' || pattern === 'PBPB') {
                nextChar = pattern[pattern.length - 1] === 'B' ? 'P' : 'B';
                predictions.push({ type: 'Mô hình ' + pattern, value: nextChar, strength: 78 });
                confidenceScores.push(78);
            } else if (pattern === 'BBPP' || pattern === 'PPBB') {
                nextChar = pattern[pattern.length - 1] === 'B' ? 'P' : 'B';
                predictions.push({ type: 'Mô hình ' + pattern, value: nextChar, strength: 72 });
                confidenceScores.push(72);
            }
        }
    }
    
    // 12. PHÂN TÍCH CHUỖI STREAK
    if (statsAll.streaks.length > 0) {
        var lastStreak = statsAll.streaks[statsAll.streaks.length - 1];
        if (lastStreak.length >= 4) {
            var nextChar = lastStreak.type === 'B' ? 'P' : 'B';
            predictions.push({ type: 'Break Streak', value: nextChar, strength: 70 });
            confidenceScores.push(70);
        }
        if (lastStreak.length >= 6) {
            var nextChar = lastStreak.type === 'B' ? 'P' : 'B';
            predictions.push({ type: 'Break Long Streak', value: nextChar, strength: 85 });
            confidenceScores.push(85);
        }
    }
    
    // TỔNG HỢP VÀ CHỌN DỰ ĐOÁN TỐT NHẤT
    var finalPrediction = 'B';
    var finalConfidence = 50;
    var finalPattern = 'Chưa xác định';
    var bestScore = 0;
    
    if (predictions.length > 0) {
        var weightedB = 0, weightedP = 0;
        
        for (var i = 0; i < predictions.length; i++) {
            var pred = predictions[i];
            if (pred.value === 'B') {
                weightedB += pred.strength;
            } else if (pred.value === 'P') {
                weightedP += pred.strength;
            }
        }
        
        if (weightedB > weightedP) {
            finalPrediction = 'B';
            finalConfidence = Math.round((weightedB / (weightedB + weightedP)) * 100);
            for (var i = 0; i < predictions.length; i++) {
                if (predictions[i].value === 'B' && predictions[i].strength > bestScore) {
                    bestScore = predictions[i].strength;
                    finalPattern = predictions[i].type;
                }
            }
        } else if (weightedP > weightedB) {
            finalPrediction = 'P';
            finalConfidence = Math.round((weightedP / (weightedB + weightedP)) * 100);
            for (var i = 0; i < predictions.length; i++) {
                if (predictions[i].value === 'P' && predictions[i].strength > bestScore) {
                    bestScore = predictions[i].strength;
                    finalPattern = predictions[i].type;
                }
            }
        } else {
            var lastChar = rounds.length > 0 ? rounds[rounds.length - 1] : 'B';
            finalPrediction = lastChar === 'B' ? 'P' : 'B';
            finalConfidence = 55;
            finalPattern = 'Bẻ cầu khi hòa';
        }
    } else {
        var lastChar = rounds.length > 0 ? rounds[rounds.length - 1] : 'B';
        finalPrediction = lastChar === 'B' ? 'P' : 'B';
        finalConfidence = 50;
        finalPattern = 'Dự đoán cơ bản';
    }
    
    if (rounds.length > 30) finalConfidence += 5;
    if (rounds.length > 50) finalConfidence += 5;
    if (rounds.length > 100) finalConfidence += 5;
    finalConfidence = Math.min(finalConfidence, 99);
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        pattern: finalPattern
    };
}

// ======================
// CẬP NHẬT DỰ ĐOÁN
// ======================
function updatePredictions() {
    if (!baccaratData || baccaratData.length === 0) return;
    
    predictionData = baccaratData.map(function(table) {
        var analysis = advancedPrediction(table.result);
        
        // Lấy số pattern đã lưu từ fetch
        var totalPatterns = table.totalPatterns || 0;
        
        // Phiên dự đoán = tổng số pattern + 1
        var nextRound = totalPatterns + 1;
        
        return {
            table: table.table,
            round: nextRound,
            prediction: analysis.prediction,
            confidence: analysis.confidence,
            pattern: analysis.pattern
        };
    });
}

// ======================
// VÒNG LẶP TỰ ĐỘNG CẬP NHẬT
// ======================
async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await new Promise(function(resolve) { setTimeout(resolve, 2000); });
    }
}

// ======================
// KHỞI TẠO API SERVER
// ======================
var app = express();

app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

app.get('/api/vanhoa', function(req, res) {
    res.json({
        success: true,
        data: predictionData,
        lastUpdate: lastUpdate,
        total: predictionData.length
    });
});

app.get('/api/predict/:table', function(req, res) {
    var tableName = req.params.table;
    var found = null;
    for (var i = 0; i < predictionData.length; i++) {
        if (predictionData[i].table === tableName) {
            found = predictionData[i];
            break;
        }
    }
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

app.get('/api/baccarat', function(req, res) {
    res.json({ success: true, data: baccaratData, lastUpdate: lastUpdate, total: baccaratData.length });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT AI PREDICTION');
    console.log('========================================');
    console.log('[1] Đang đăng nhập...');
    var loginOk = await login();
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
    console.log('[OK] Đã lấy ' + baccaratData.length + ' bàn');
    
    console.log('\n📊 DỰ ĐOÁN CHI TIẾT:');
    for (var i = 0; i < predictionData.length; i++) {
        var item = predictionData[i];
        console.log('   Bàn ' + item.table + ': Phiên ' + item.round + ' -> ' + item.prediction + ' (Độ tin cậy: ' + item.confidence + '%) - ' + item.pattern);
    }
    
    autoUpdate();
    
    var PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', function() {
        console.log('\n🚀 API SERVER ĐANG CHẠY:');
        console.log('   /api/vanhoa - Dự đoán tất cả bàn');
        console.log('   /api/predict/1 - Dự đoán bàn cụ thể');
        console.log('   /api/baccarat - Lịch sử');
        console.log('\n⏰ Update mỗi 2 giây');
        console.log('✅ Phiên dự đoán = Tổng số pattern + 1');
    });
}

start();
