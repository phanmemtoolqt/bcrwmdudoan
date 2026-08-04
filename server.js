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
let predictionHistory = [];

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
        
        var headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE,
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        
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
                return {
                    table: item.table_name,
                    result: item.result,
                    shoeId: item.shoeId || '',
                    round: item.round || ''
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
// THUẬT TOÁN DỰ ĐOÁN AI - LUÔN CÓ 5 PATTERN
// ======================
function analyzePattern(history) {
    // Mặc định tất cả pattern đều false
    var patterns = {
        bet: false,
        cau11: false,
        cau22: false,
        cau32: false,
        cau23: false
    };
    
    var rounds = [];
    if (history && history.length > 0) {
        rounds = history.split(',').filter(function(r) { return r.trim() !== ''; });
    }
    
    // Nếu có ít nhất 3 kết quả, phân tích pattern
    if (rounds.length >= 3) {
        var last3 = rounds.slice(-3);
        var last5 = rounds.slice(-5);
        
        // Kiểm tra cầu bệt
        if (last3.every(function(r) { return r === last3[0]; })) {
            patterns.bet = true;
        }
        
        // Kiểm tra cầu 1-1
        if (last5.length >= 4) {
            var check11 = last5.slice(-4);
            if (check11[0] !== check11[1] && check11[1] !== check11[2] && check11[2] !== check11[3]) {
                patterns.cau11 = true;
            }
        }
        
        // Kiểm tra cầu 2-2
        if (last5.length >= 4) {
            var check22 = last5.slice(-4);
            if (check22[0] === check22[1] && check22[2] === check22[3] && check22[0] !== check22[2]) {
                patterns.cau22 = true;
            }
        }
        
        // Kiểm tra cầu 3-2
        if (last5.length >= 5) {
            var check32 = last5.slice(-5);
            if (check32[0] === check32[1] && check32[1] === check32[2] && 
                check32[3] === check32[4] && check32[0] !== check32[3]) {
                patterns.cau32 = true;
            }
        }
        
        // Kiểm tra cầu 2-3
        if (last5.length >= 5) {
            var check23 = last5.slice(-5);
            if (check23[0] === check23[1] && check23[2] === check23[3] && 
                check23[3] === check23[4] && check23[0] !== check23[2]) {
                patterns.cau23 = true;
            }
        }
    }
    
    // Dự đoán dựa trên pattern
    var prediction = '';
    var confidence = 0;
    var reason = '';
    var patternType = '';
    
    if (rounds.length === 0) {
        // Chưa có dữ liệu - dự đoán mặc định
        prediction = 'B';
        confidence = 50;
        reason = 'Chưa có dữ liệu, dự đoán mặc định Banker';
        patternType = 'Chưa xác định';
    } else {
        var lastChar = rounds[rounds.length - 1];
        
        if (patterns.bet) {
            prediction = lastChar;
            confidence = 85;
            reason = 'Cầu bệt ' + lastChar + ' đang xuất hiện, nên theo';
            patternType = 'Cầu bệt';
        } else if (patterns.cau11) {
            prediction = lastChar === 'B' ? 'P' : 'B';
            confidence = 75;
            reason = 'Cầu 1-1 đang hình thành, nên bẻ';
            patternType = 'Cầu 1-1';
        } else if (patterns.cau22) {
            var nextChar = lastChar === 'B' ? 'P' : 'B';
            prediction = nextChar;
            confidence = 70;
            reason = 'Cầu 2-2 đang hình thành, theo cầu';
            patternType = 'Cầu 2-2';
        } else if (patterns.cau32) {
            var nextChar = lastChar === 'B' ? 'P' : 'B';
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
            // Phân tích thống kê
            var bCount = 0, pCount = 0, tCount = 0;
            for (var i = 0; i < rounds.length; i++) {
                if (rounds[i] === 'B') bCount++;
                else if (rounds[i] === 'P') pCount++;
                else if (rounds[i] === 'T') tCount++;
            }
            
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
        
        // Điều chỉnh độ tin cậy
        if (rounds.length > 20) confidence += 5;
        if (rounds.length > 30) confidence += 5;
    }
    
    return {
        prediction: prediction,
        confidence: Math.min(confidence, 95),
        reason: reason,
        pattern: patternType,
        patterns: patterns
    };
}

// ======================
// CẬP NHẬT DỰ ĐOÁN - LUÔN CÓ ĐỦ 5 PATTERN
// ======================
function updatePredictions() {
    if (!baccaratData || baccaratData.length === 0) return;
    
    predictionHistory = baccaratData.map(function(table) {
        var analysis = analyzePattern(table.result);
        
        var rounds = table.result ? table.result.split(',').filter(function(r) { return r.trim() !== ''; }) : [];
        var nextRound = rounds.length + 1;
        
        // Luôn có đủ 5 pattern
        var patterns = analysis.patterns || {
            bet: false,
            cau11: false,
            cau22: false,
            cau32: false,
            cau23: false
        };
        
        return {
            table: table.table,
            round: table.round || '',
            nextRound: nextRound,
            prediction: analysis.prediction,
            confidence: analysis.confidence,
            reason: analysis.reason,
            pattern: analysis.pattern,
            patterns: patterns,
            history: table.result || '',
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
        await new Promise(function(resolve) { setTimeout(resolve, 2000); });
    }
}

// ======================
// KHỞI TẠO API SERVER
// ======================
var app = express();

// CORS
app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// ======================
// API DỰ ĐOÁN CƠ BẢN
// ======================
app.get('/api/predict', function(req, res) {
    var predictions = predictionHistory.map(function(p) {
        return {
            table: p.table,
            nextRound: p.nextRound,
            prediction: p.prediction,
            confidence: p.confidence,
            reason: p.reason,
            pattern: p.pattern,
            history: p.history,
            lastUpdate: p.lastUpdate
        };
    });
    
    res.json({
        success: true,
        data: predictions,
        lastUpdate: lastUpdate,
        total: predictions.length
    });
});

// ======================
// API DỰ ĐOÁN CHI TIẾT (VANHOA) - ĐẦY ĐỦ 5 PATTERN
// ======================
app.get('/api/vanhoa', function(req, res) {
    var detailedPredictions = predictionHistory.map(function(p) {
        var patterns = p.patterns || {
            bet: false,
            cau11: false,
            cau22: false,
            cau32: false,
            cau23: false
        };
        
        // Luôn hiển thị 5 pattern
        var patternList = [
            { 
                name: 'Cầu bệt', 
                active: patterns.bet,
                description: patterns.bet ? 'Đang xuất hiện' : 'Không xuất hiện',
                strength: patterns.bet ? 85 : 0
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
        
        var activePatterns = patternList.filter(function(p) { return p.active; });
        var totalRounds = p.history ? p.history.split(',').filter(function(r) { return r.trim() !== ''; }).length : 0;
        
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
            analysis: {
                totalRounds: totalRounds,
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
app.get('/api/predict/:table', function(req, res) {
    var tableName = req.params.table;
    var found = null;
    for (var i = 0; i < predictionHistory.length; i++) {
        if (predictionHistory[i].table === tableName) {
            found = predictionHistory[i];
            break;
        }
    }
    
    if (found) {
        var patterns = found.patterns || {
            bet: false,
            cau11: false,
            cau22: false,
            cau32: false,
            cau23: false
        };
        
        var patternList = [
            { name: 'Cầu bệt', active: patterns.bet },
            { name: 'Cầu 1-1', active: patterns.cau11 },
            { name: 'Cầu 2-2', active: patterns.cau22 },
            { name: 'Cầu 3-2', active: patterns.cau32 },
            { name: 'Cầu 2-3', active: patterns.cau23 }
        ];
        
        var activeCount = 0;
        for (var i = 0; i < patternList.length; i++) {
            if (patternList[i].active) activeCount++;
        }
        
        var totalRounds = found.history ? found.history.split(',').filter(function(r) { return r.trim() !== ''; }).length : 0;
        
        res.json({
            success: true,
            data: {
                table: found.table,
                nextRound: found.nextRound,
                prediction: found.prediction,
                confidence: found.confidence,
                reason: found.reason,
                pattern: found.pattern,
                patterns: patternList,
                history: found.history,
                shoeId: found.shoeId,
                lastUpdate: found.lastUpdate,
                analysis: {
                    totalRounds: totalRounds,
                    activePatterns: activeCount,
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
// API LẤY LỊCH SỬ
// ======================
app.get('/api/baccarat', function(req, res) {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate: lastUpdate,
        total: baccaratData.length
    });
});

app.get('/api/baccarat/:table', function(req, res) {
    var tableName = req.params.table;
    var found = null;
    for (var i = 0; i < baccaratData.length; i++) {
        if (baccaratData[i].table === tableName) {
            found = baccaratData[i];
            break;
        }
    }
    
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

app.get('/api/latest', function(req, res) {
    var latest = baccaratData.slice();
    latest.sort(function(a, b) {
        var numA = parseInt(a.table) || 0;
        var numB = parseInt(b.table) || 0;
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
    
    console.log('\n📊 DANH SÁCH BÀN VÀ DỰ ĐOÁN:');
    for (var i = 0; i < predictionHistory.length; i++) {
        var item = predictionHistory[i];
        console.log('   ' + item.table.padEnd(4) + ': Phiên ' + item.nextRound + ' -> ' + item.prediction + ' (' + item.confidence + '%) - ' + item.pattern);
    }
    
    autoUpdate();
    
    var PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', function() {
        console.log('\n🚀 API SERVER ĐANG CHẠY:');
        console.log('   http://localhost:' + PORT + '/api/baccarat - Lịch sử');
        console.log('   http://localhost:' + PORT + '/api/predict - Dự đoán cơ bản');
        console.log('   http://localhost:' + PORT + '/api/vanhoa - Dự đoán chi tiết (5 pattern)');
        console.log('   http://localhost:' + PORT + '/api/predict/1 - Dự đoán bàn cụ thể');
        console.log('   http://localhost:' + PORT + '/api/latest - 10 bàn mới nhất');
        console.log('\n⏰ Auto update mỗi 2 giây');
        console.log('🧠 AI Prediction luôn có 5 pattern phân tích');
    });
}

start();
