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
let historicalData = {}; // Lưu lịch sử cho từng bàn

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
// PHÂN TÍCH PATTERN
// ======================
function analyzePattern(history) {
    if (!history || history.length < 5) {
        return {
            pattern: 'Chưa đủ dữ liệu',
            confidence: 0,
            suggestion: 'Chờ thêm kết quả',
            nextPrediction: 'N/A'
        };
    }

    // Chuyển đổi kết quả thành dạng chuỗi: B (Banker), P (Player), T (Tie)
    const results = history.map(r => {
        if (r.includes('Banker') || r.includes('BANKER')) return 'B';
        if (r.includes('Player') || r.includes('PLAYER')) return 'P';
        return 'T';
    });

    // 1. PHÂN TÍCH CẦU ĐƠN (Single Pattern)
    let pattern = '';
    let confidence = 0;
    let nextPrediction = '';
    let suggestion = '';

    // Kiểm tra cầu 1-1 (Alternating)
    let isAlternating = true;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1]) {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating && results.length >= 4) {
        pattern = 'Cầu 1-1 (Đan xen)';
        confidence = 75;
        nextPrediction = results[results.length - 1] === 'B' ? 'P' : 'B';
        suggestion = 'THEO - Cầu đan xen đang mạnh';
    }

    // Kiểm tra cầu 2-2 (Double)
    if (!pattern) {
        let isDouble = true;
        let pairs = [];
        for (let i = 0; i < results.length - 1; i += 2) {
            if (results[i] !== results[i+1]) {
                isDouble = false;
                break;
            }
            pairs.push(results[i]);
        }
        if (isDouble && results.length >= 4) {
            pattern = 'Cầu 2-2 (Kép đôi)';
            confidence = 80;
            const lastPair = results[results.length - 1];
            nextPrediction = lastPair === 'B' ? 'B' : 'P';
            suggestion = 'THEO - Cầu kép đôi ổn định';
        }
    }

    // Kiểm tra cầu 3-2 (Fibonacci)
    if (!pattern) {
        let counts = { B: 0, P: 0, T: 0 };
        results.forEach(r => { if (r !== 'T') counts[r]++; });
        
        const total = results.filter(r => r !== 'T').length;
        const bRatio = counts.B / total;
        const pRatio = counts.P / total;
        
        if (Math.abs(bRatio - pRatio) > 0.3) {
            pattern = 'Cầu lệch (Ưu thế)';
            confidence = 70;
            if (bRatio > pRatio) {
                nextPrediction = 'B';
                suggestion = 'THEO - Banker đang chiếm ưu thế';
            } else {
                nextPrediction = 'P';
                suggestion = 'THEO - Player đang chiếm ưu thế';
            }
        }
    }

    // Kiểm tra cầu vượt (Streak)
    if (!pattern) {
        let currentStreak = 1;
        let maxStreak = 1;
        let streakResult = results[0];
        
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i-1]) {
                currentStreak++;
                if (currentStreak > maxStreak) {
                    maxStreak = currentStreak;
                    streakResult = results[i];
                }
            } else {
                currentStreak = 1;
            }
        }
        
        if (maxStreak >= 3) {
            pattern = `Cầu vượt (${maxStreak} ${streakResult === 'B' ? 'Banker' : 'Player'})`;
            confidence = 85;
            nextPrediction = streakResult;
            suggestion = 'THEO - Cầu vượt mạnh, tiếp tục theo đà';
        }
    }

    // Nếu không có pattern rõ ràng
    if (!pattern) {
        pattern = 'Cầu hỗn hợp (Không rõ ràng)';
        confidence = 50;
        // Dùng phương pháp đơn giản: chọn bên nào có xác suất cao hơn
        const counts = { B: 0, P: 0, T: 0 };
        results.forEach(r => { if (r !== 'T') counts[r]++; });
        const total = results.filter(r => r !== 'T').length;
        
        if (counts.B > counts.P) {
            nextPrediction = 'B';
            suggestion = 'BẺ - Cầu đang phức tạp, cân nhắc Banker';
        } else if (counts.P > counts.B) {
            nextPrediction = 'P';
            suggestion = 'BẺ - Cầu đang phức tạp, cân nhắc Player';
        } else {
            nextPrediction = 'B';
            suggestion = 'BẺ - Cầu cân bằng, chọn Banker (tỷ lệ thắng cao hơn)';
        }
    }

    return {
        pattern,
        confidence: Math.min(confidence, 95),
        suggestion,
        nextPrediction,
        lastResults: results.slice(-10).join(' → ')
    };
}

// ======================
// TẠO DỰ ĐOÁN CHO PHIÊN TIẾP THEO
// ======================
function generatePrediction(tableName, history) {
    const analysis = analyzePattern(history);
    
    // Lấy phiên hiện tại
    let currentRound = 0;
    if (history && history.length > 0) {
        // Tìm số phiên từ dữ liệu
        const match = history[history.length - 1].match(/[0-9]+/);
        if (match) {
            currentRound = parseInt(match[0]) || 0;
        }
    }
    const nextRound = currentRound + 1;

    // Xác định độ tin cậy dựa trên số lượng mẫu
    let reliability = 'Thấp';
    if (history.length >= 20) reliability = 'Cao';
    else if (history.length >= 10) reliability = 'Trung bình';

    return {
        tableName: tableName,
        round: nextRound,
        prediction: analysis.nextPrediction,
        confidence: analysis.confidence,
        pattern: analysis.pattern,
        suggestion: analysis.suggestion,
        reliability: reliability,
        sampleCount: history.length,
        lastResults: analysis.lastResults || 'Chưa có dữ liệu',
        timestamp: new Date().toISOString()
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
            // Cập nhật dữ liệu mới
            const newData = resp.data.data.map(item => ({
                table: item.table_name,
                result: item.result,
                shoeId: item.shoeId || '',
                round: item.round || ''
            }));
            
            // Lưu lịch sử cho từng bàn
            newData.forEach(item => {
                if (!historicalData[item.table]) {
                    historicalData[item.table] = [];
                }
                // Chỉ thêm nếu chưa có
                const exists = historicalData[item.table].some(
                    h => h.result === item.result && h.round === item.round
                );
                if (!exists) {
                    historicalData[item.table].push(item);
                    // Giữ tối đa 50 kết quả gần nhất
                    if (historicalData[item.table].length > 50) {
                        historicalData[item.table] = historicalData[item.table].slice(-50);
                    }
                }
            });
            
            baccaratData = newData;
            lastUpdate = new Date().toISOString();
        }
        
        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return [];
    }
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
// API DỰ ĐOÁN
// ======================

// Dự đoán cho tất cả bàn
app.get('/api/vanhoa', (req, res) => {
    try {
        const predictions = [];
        const tables = Object.keys(historicalData);
        
        tables.forEach(tableName => {
            const history = historicalData[tableName] || [];
            if (history.length >= 5) {
                const prediction = generatePrediction(tableName, history);
                predictions.push(prediction);
            }
        });
        
        // Sắp xếp theo độ tin cậy giảm dần
        predictions.sort((a, b) => b.confidence - a.confidence);
        
        res.json({
            success: true,
            totalTables: predictions.length,
            predictions: predictions,
            timestamp: new Date().toISOString(),
            message: 'Dự đoán cho tất cả bàn Baccarat'
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
        
        if (history.length < 5) {
            return res.json({
                success: false,
                message: `Chưa đủ dữ liệu cho bàn ${tableName}. Cần ít nhất 5 kết quả.`,
                currentData: history.length
            });
        }
        
        const prediction = generatePrediction(tableName, history);
        res.json({
            success: true,
            prediction: prediction,
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

// API thống kê
app.get('/api/stats', (req, res) => {
    const stats = {};
    const tables = Object.keys(historicalData);
    
    tables.forEach(tableName => {
        const history = historicalData[tableName] || [];
        const results = history.map(h => h.result);
        const banker = results.filter(r => r.includes('Banker') || r.includes('BANKER')).length;
        const player = results.filter(r => r.includes('Player') || r.includes('PLAYER')).length;
        const tie = results.filter(r => r.includes('Tie') || r.includes('TIE') || r.includes('tie')).length;
        
        stats[tableName] = {
            total: results.length,
            banker: banker,
            player: player,
            tie: tie,
            bankerPercent: results.length > 0 ? ((banker / results.length) * 100).toFixed(1) + '%' : '0%',
            playerPercent: results.length > 0 ? ((player / results.length) * 100).toFixed(1) + '%' : '0%',
            tiePercent: results.length > 0 ? ((tie / results.length) * 100).toFixed(1) + '%' : '0%'
        };
    });
    
    res.json({
        success: true,
        stats: stats,
        timestamp: new Date().toISOString()
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
    
    // Hiển thị danh sách bàn
    console.log('\n📊 DANH SÁCH BÀN:');
    baccaratData.forEach(item => {
        const resultShort = item.result.substring(0, 30) + (item.result.length > 30 ? '...' : '');
        console.log(`   ${item.table.padEnd(4)}: ${resultShort}`);
    });
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   http://localhost:${PORT}/api/baccarat`);
        console.log(`   http://localhost:${PORT}/api/baccarat/1`);
        console.log(`   http://localhost:${PORT}/api/vanhoa - Dự đoán tất cả`);
        console.log(`   http://localhost:${PORT}/api/vanhoa/C01 - Dự đoán bàn cụ thể`);
        console.log(`   http://localhost:${PORT}/api/history/C01 - Lịch sử bàn`);
        console.log(`   http://localhost:${PORT}/api/stats - Thống kê`);
        console.log(`\n⏰ Auto update mỗi 2 giây`);
        console.log(`\n📈 Hệ thống dự đoán đã sẵn sàng!`);
    });
}

start();
