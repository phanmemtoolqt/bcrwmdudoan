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
let dataBuffer = []; // Buffer để lưu tất cả kết quả

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
// PHÂN TÍCH PATTERN - CẢI TIẾN
// ======================
function analyzePattern(history) {
    if (!history || history.length < 5) {
        return {
            pattern: 'Chưa đủ dữ liệu',
            confidence: 0,
            suggestion: 'Cần ít nhất 5 kết quả để phân tích',
            nextPrediction: 'N/A',
            lastResults: 'Chưa có dữ liệu'
        };
    }

    // Chuyển đổi kết quả thành dạng chuỗi: B (Banker), P (Player), T (Tie)
    const results = history.map(r => {
        const resultStr = String(r.result || r).toUpperCase();
        if (resultStr.includes('BANKER')) return 'B';
        if (resultStr.includes('PLAYER')) return 'P';
        if (resultStr.includes('TIE') || resultStr.includes('T')) return 'T';
        return '?';
    }).filter(r => r !== '?');

    if (results.length < 5) {
        return {
            pattern: 'Chưa đủ dữ liệu',
            confidence: 0,
            suggestion: 'Cần ít nhất 5 kết quả hợp lệ',
            nextPrediction: 'N/A',
            lastResults: results.join(' → ')
        };
    }

    let pattern = '';
    let confidence = 0;
    let nextPrediction = '';
    let suggestion = '';
    let foundPattern = false;

    // 1. KIỂM TRA CẦU 1-1 (ĐAN XEN)
    let isAlternating = true;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1] || results[i] === 'T' || results[i-1] === 'T') {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating && results.length >= 4) {
        pattern = '🏆 Cầu 1-1 (Đan xen)';
        confidence = 80;
        const last = results[results.length - 1];
        nextPrediction = last === 'B' ? 'P' : 'B';
        suggestion = '👉 THEO - Cầu đan xen đang mạnh';
        foundPattern = true;
    }

    // 2. KIỂM TRA CẦU 2-2 (KÉP ĐÔI)
    if (!foundPattern) {
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
            pattern = '🏆 Cầu 2-2 (Kép đôi)';
            confidence = 85;
            const last = results[results.length - 1];
            nextPrediction = last === 'B' ? 'B' : 'P';
            suggestion = '👉 THEO - Cầu kép đôi ổn định';
            foundPattern = true;
        }
    }

    // 3. KIỂM TRA CẦU VƯỢT (STREAK)
    if (!foundPattern) {
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
            pattern = `🏆 Cầu vượt (${maxStreak} ${name})`;
            confidence = Math.min(75 + maxStreak * 3, 95);
            nextPrediction = streakResult;
            suggestion = `👉 THEO - Cầu vượt mạnh, tiếp tục theo ${name}`;
            foundPattern = true;
        }
    }

    // 4. KIỂM TRA CẦU LỆCH (THỐNG KÊ)
    if (!foundPattern) {
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
            pattern = '📊 Cầu lệch (Thống kê)';
            confidence = 70;
            if (bRatio > pRatio) {
                nextPrediction = 'B';
                suggestion = `👉 THEO - Banker ${(bRatio*100).toFixed(1)}% đang chiếm ưu thế`;
            } else {
                nextPrediction = 'P';
                suggestion = `👉 THEO - Player ${(pRatio*100).toFixed(1)}% đang chiếm ưu thế`;
            }
            foundPattern = true;
        }
    }

    // 5. NẾU KHÔNG CÓ PATTERN RÕ RÀNG - DỰ ĐOÁN THEO XÁC SUẤT
    if (!foundPattern) {
        const counts = { B: 0, P: 0, T: 0 };
        results.forEach(r => {
            if (r === 'B') counts.B++;
            else if (r === 'P') counts.P++;
            else if (r === 'T') counts.T++;
        });
        
        const total = results.length;
        const bRatio = counts.B / total;
        const pRatio = counts.P / total;
        
        pattern = '🔄 Cầu hỗn hợp';
        confidence = 55;
        
        if (bRatio > pRatio) {
            nextPrediction = 'B';
            suggestion = `⚖️ BẺ - Cầu đang phức tạp, ưu tiên Banker (${(bRatio*100).toFixed(1)}%)`;
        } else if (pRatio > bRatio) {
            nextPrediction = 'P';
            suggestion = `⚖️ BẺ - Cầu đang phức tạp, ưu tiên Player (${(pRatio*100).toFixed(1)}%)`;
        } else {
            nextPrediction = 'B';
            suggestion = '⚖️ BẺ - Cầu cân bằng, chọn Banker (tỷ lệ thắng cao hơn)';
        }
    }

    // Lấy 10 kết quả gần nhất để hiển thị
    const last10 = results.slice(-10);
    const lastResultsStr = last10.join(' → ');

    return {
        pattern,
        confidence: Math.min(Math.round(confidence), 95),
        suggestion,
        nextPrediction,
        lastResults: lastResultsStr,
        stats: {
            B: results.filter(r => r === 'B').length,
            P: results.filter(r => r === 'P').length,
            T: results.filter(r => r === 'T').length,
            total: results.length
        }
    };
}

// ======================
// TẠO DỰ ĐOÁN CHO PHIÊN TIẾP THEO
// ======================
function generatePrediction(tableName, history) {
    if (!history || history.length < 5) {
        return {
            tableName: tableName,
            round: 1,
            prediction: 'N/A',
            confidence: 0,
            pattern: 'Chưa đủ dữ liệu',
            suggestion: 'Cần ít nhất 5 kết quả để phân tích',
            reliability: 'Không đủ dữ liệu',
            sampleCount: history ? history.length : 0,
            lastResults: 'Chưa có dữ liệu',
            timestamp: new Date().toISOString(),
            status: 'Đang thu thập dữ liệu...'
        };
    }

    const analysis = analyzePattern(history);
    
    // Xác định độ tin cậy dựa trên số lượng mẫu và confidence
    let reliability = 'Thấp';
    if (history.length >= 20 && analysis.confidence >= 75) {
        reliability = 'Cao 🟢';
    } else if (history.length >= 10 && analysis.confidence >= 60) {
        reliability = 'Trung bình 🟡';
    } else if (history.length >= 5 && analysis.confidence >= 40) {
        reliability = 'Thấp 🟠';
    } else {
        reliability = 'Chưa đủ 🟢';
    }

    // Lấy phiên hiện tại
    let currentRound = 0;
    if (history && history.length > 0) {
        const lastItem = history[history.length - 1];
        if (lastItem.round) {
            currentRound = parseInt(lastItem.round) || 0;
        } else {
            // Nếu không có round, dùng index
            currentRound = history.length;
        }
    }
    const nextRound = currentRound + 1;

    return {
        tableName: tableName,
        round: nextRound,
        prediction: analysis.nextPrediction,
        confidence: analysis.confidence + '%',
        pattern: analysis.pattern,
        suggestion: analysis.suggestion,
        reliability: reliability,
        sampleCount: history.length,
        lastResults: analysis.lastResults || 'Chưa có dữ liệu',
        stats: analysis.stats || {},
        timestamp: new Date().toISOString(),
        status: '✅ Sẵn sàng'
    };
}

// ======================
// LẤY KẾT QUẢ BACCARAT - CẢI TIẾN LƯU LỊCH SỬ
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

            // Cập nhật dữ liệu hiện tại
            baccaratData = newData;
            
            // LƯU LỊCH SỬ CHO TỪNG BÀN
            newData.forEach(item => {
                const tableName = item.table;
                
                // Khởi tạo nếu chưa có
                if (!historicalData[tableName]) {
                    historicalData[tableName] = [];
                }
                
                // Kiểm tra xem đã có kết quả này chưa (tránh duplicate)
                const exists = historicalData[tableName].some(
                    h => h.result === item.result && h.round === item.round
                );
                
                if (!exists) {
                    // Thêm vào lịch sử
                    historicalData[tableName].push({
                        result: item.result,
                        round: item.round,
                        shoeId: item.shoeId,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Giữ tối đa 50 kết quả gần nhất
                    if (historicalData[tableName].length > 50) {
                        historicalData[tableName] = historicalData[tableName].slice(-50);
                    }
                }
            });

            // Cập nhật buffer tổng
            dataBuffer = dataBuffer.concat(newData);
            if (dataBuffer.length > 500) {
                dataBuffer = dataBuffer.slice(-500);
            }

            lastUpdate = new Date().toISOString();
            
            // Log để debug
            console.log(`[${new Date().toLocaleTimeString()}] Đã cập nhật ${newData.length} bàn, tổng lịch sử: ${Object.keys(historicalData).length} bàn`);
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
    let count = 0;
    while (true) {
        try {
            await fetchBaccaratData();
            count++;
            if (count % 10 === 0) {
                // Mỗi 20 giây log trạng thái
                const totalHistory = Object.values(historicalData).reduce((sum, arr) => sum + arr.length, 0);
                console.log(`📊 Tổng dữ liệu: ${Object.keys(historicalData).length} bàn, ${totalHistory} kết quả`);
            }
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
// API DỰ ĐOÁN - CẢI TIẾN
// ======================

// Dự đoán cho tất cả bàn
app.get('/api/vanhoa', (req, res) => {
    try {
        const predictions = [];
        const tables = Object.keys(historicalData);
        
        console.log(`🔮 Đang dự đoán cho ${tables.length} bàn...`);
        
        tables.forEach(tableName => {
            const history = historicalData[tableName] || [];
            if (history.length >= 5) {
                const prediction = generatePrediction(tableName, history);
                predictions.push(prediction);
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
            totalTables: predictions.length,
            totalTablesWithData: tables.length,
            predictions: predictions,
            timestamp: new Date().toISOString(),
            message: predictions.length > 0 
                ? `✅ Dự đoán thành công ${predictions.length}/${tables.length} bàn` 
                : '⏳ Đang thu thập dữ liệu, vui lòng đợi 1-2 phút...'
        });
    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Lỗi hệ thống dự đoán'
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
                currentData: history.length,
                status: 'Đang thu thập dữ liệu...'
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
        const results = history.map(h => String(h.result || '').toUpperCase());
        const banker = results.filter(r => r.includes('BANKER')).length;
        const player = results.filter(r => r.includes('PLAYER')).length;
        const tie = results.filter(r => r.includes('TIE')).length;
        
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
        totalTables: tables.length,
        timestamp: new Date().toISOString()
    });
});

// API dashboard - Tổng quan
app.get('/api/dashboard', (req, res) => {
    const tables = Object.keys(historicalData);
    let totalResults = 0;
    tables.forEach(t => {
        totalResults += historicalData[t].length;
    });
    
    res.json({
        success: true,
        totalTables: tables.length,
        totalResults: totalResults,
        lastUpdate: lastUpdate,
        tables: tables,
        status: '🟢 Hệ thống đang hoạt động'
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('🃏 BACCARAT API SERVER + DỰ ĐOÁN PRO');
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
    
    // Hiển thị danh sách bàn và lịch sử
    console.log('\n📊 DANH SÁCH BÀN VÀ DỮ LIỆU:');
    const tables = Object.keys(historicalData);
    if (tables.length > 0) {
        tables.forEach(table => {
            const history = historicalData[table] || [];
            console.log(`   ${table.padEnd(6)}: ${history.length} kết quả`);
            if (history.length > 0) {
                const last = history[history.length - 1];
                console.log(`      ➜ Gần nhất: ${last.result}`);
            }
        });
    } else {
        console.log('   ⏳ Đang thu thập dữ liệu...');
    }
    
    console.log(`\n📈 TỔNG QUAN:`);
    console.log(`   - Số bàn: ${Object.keys(historicalData).length}`);
    console.log(`   - Tổng kết quả: ${Object.values(historicalData).reduce((sum, arr) => sum + arr.length, 0)}`);
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   📍 http://localhost:${PORT}`);
        console.log(`\n🔮 CÁC API DỰ ĐOÁN:`);
        console.log(`   📊 /api/vanhoa        - Dự đoán TẤT CẢ bàn`);
        console.log(`   🎯 /api/vanhoa/C01    - Dự đoán bàn cụ thể`);
        console.log(`   📈 /api/history/C01   - Lịch sử bàn`);
        console.log(`   📊 /api/stats         - Thống kê chi tiết`);
        console.log(`   📋 /api/dashboard     - Tổng quan hệ thống`);
        console.log(`\n⏰ Auto update mỗi 2 giây`);
        console.log(`\n✅ HỆ THỐNG SẴN SÀNG!`);
    });
}

// Bắt lỗi toàn cục
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

start();
