// server.js - Baccarat Prediction Server (Complete)
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH ====================
const CONFIG = {
  API_URL: 'https://liichubc.onrender.com/api/baccarat',
  MAX_ORDER: 3,              // Bậc Markov tối đa
  DEFAULT_LAST_N: 34,        // Số ván cuối để dự đoán
  MIN_SEQUENCE_LENGTH: 3,    // Độ dài tối thiểu để dự đoán
  CONFIDENCE_THRESHOLD: 0.6, // Ngưỡng tin cậy để đưa ra khuyến nghị
  WEIGHT_RECENT: 0.7,        // Trọng số cho các ván gần đây
  RECENT_COUNT: 20           // Số ván gần đây được ưu tiên
};

// ==================== HÀM LẤY DỮ LIỆU ====================
async function fetchBaccaratData() {
  try {
    const response = await fetch(CONFIG.API_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Dữ liệu không đúng định dạng');
    }
    return data.data;
  } catch (error) {
    console.error('Lỗi fetch dữ liệu:', error);
    throw error;
  }
}

// ==================== THUẬT TOÁN MARKOV ====================
/**
 * Xây dựng mô hình Markov đa bậc
 * @param {string} sequence - Chuỗi kết quả (B, P, T)
 * @param {number} maxOrder - Bậc tối đa
 * @param {number} weightRecent - Trọng số cho các ván gần đây
 * @returns {Object} Model: { order: { pattern: { nextChar: count } } }
 */
function buildMarkovModel(sequence, maxOrder = CONFIG.MAX_ORDER, weightRecent = 0) {
  const model = {};
  const seqLength = sequence.length;
  const recentStart = Math.max(0, seqLength - CONFIG.RECENT_COUNT);
  
  for (let order = 1; order <= maxOrder; order++) {
    if (seqLength <= order) continue;
    const trans = {};
    
    for (let i = 0; i < seqLength - order; i++) {
      const pat = sequence.slice(i, i + order);
      const nxt = sequence[i + order];
      if (!trans[pat]) trans[pat] = {};
      
      // Áp dụng trọng số cho các ván gần đây
      let weight = 1;
      if (weightRecent > 0 && i >= recentStart) {
        const distanceFromEnd = seqLength - i;
        weight = 1 + weightRecent * (distanceFromEnd / CONFIG.RECENT_COUNT);
      }
      
      trans[pat][nxt] = (trans[pat][nxt] || 0) + weight;
    }
    model[order] = trans;
  }
  return model;
}

/**
 * Dự đoán với mô hình Markov
 * @param {string} sequence - Chuỗi hiện tại
 * @param {Object} model - Mô hình Markov
 * @param {number} maxOrder - Bậc tối đa
 * @returns {Array} Dự đoán từ bậc cao xuống thấp
 */
function predictWithMarkov(sequence, model, maxOrder = CONFIG.MAX_ORDER) {
  const predictions = [];
  
  for (let order = maxOrder; order >= 1; order--) {
    if (sequence.length < order) continue;
    const pat = sequence.slice(-order);
    const trans = model[order];
    
    if (trans && trans[pat]) {
      const counter = trans[pat];
      const total = Object.values(counter).reduce((a, b) => a + b, 0);
      
      if (total > 0) {
        let maxChar = null, maxCount = 0;
        for (const [ch, count] of Object.entries(counter)) {
          if (count > maxCount) {
            maxCount = count;
            maxChar = ch;
          }
        }
        predictions.push({
          char: maxChar,
          confidence: maxCount / total,
          samples: total,
          order: order,
          detail: counter
        });
      }
    }
  }
  return predictions;
}

// ==================== THUẬT TOÁN PHÂN TÍCH PATTERN ====================
/**
 * Phân tích cầu (pattern) trong chuỗi
 */
function analyzePattern(sequence) {
  if (sequence.length < 2) return null;
  
  const patterns = {
    bệt: 0,        // Kết quả giống nhau
    đảo: 0,        // Kết quả khác nhau
    đảo_kép: 0,    // PPBBPPBB
    bệt_kép: 0,    // PPPBBBPPP
    pattern_3: 0,   // Cầu 3
    pattern_4: 0    // Cầu 4
  };
  
  // Đếm bệt/đảo cơ bản
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i] === sequence[i+1]) patterns.bệt++;
    else patterns.đảo++;
  }
  
  // Phát hiện cầu đảo kép (PPBBPPBB)
  for (let i = 0; i < sequence.length - 3; i++) {
    if (sequence[i] === sequence[i+1] && 
        sequence[i+2] === sequence[i+3] && 
        sequence[i] !== sequence[i+2]) {
      patterns.đảo_kép++;
    }
  }
  
  // Phát hiện cầu bệt kép (PPPBBBPPP)
  for (let i = 0; i < sequence.length - 5; i++) {
    if (sequence[i] === sequence[i+1] && sequence[i+1] === sequence[i+2] &&
        sequence[i+3] === sequence[i+4] && sequence[i+4] === sequence[i+5] &&
        sequence[i] !== sequence[i+3]) {
      patterns.bệt_kép++;
    }
  }
  
  // Phát hiện cầu 3 (PPPB PPPB)
  for (let i = 0; i < sequence.length - 3; i++) {
    if (sequence[i] === sequence[i+1] && sequence[i+1] === sequence[i+2] &&
        sequence[i+2] !== sequence[i+3]) {
      patterns.pattern_3++;
    }
  }
  
  // Phát hiện cầu 4 (PPPPB)
  for (let i = 0; i < sequence.length - 4; i++) {
    let allSame = true;
    for (let j = 0; j < 4; j++) {
      if (sequence[i+j] !== sequence[i]) allSame = false;
    }
    if (allSame && i+4 < sequence.length && sequence[i+4] !== sequence[i]) {
      patterns.pattern_4++;
    }
  }
  
  // Tính tỷ lệ
  const total = sequence.length - 1;
  return {
    ...patterns,
    ty_le_bet: patterns.bệt / total,
    ty_le_dao: patterns.đảo / total,
    xu_huong: patterns.bệt > patterns.đảo ? 'Bệt' : 'Đảo'
  };
}

// ==================== THUẬT TOÁN DỰ ĐOÁN TỔ HỢP ====================
/**
 * Dự đoán tổ hợp từ nhiều thuật toán
 */
function hybridPrediction(sequence, tables, allResults) {
  // 1. Dự đoán Markov
  const model = buildMarkovModel(sequence, CONFIG.MAX_ORDER, CONFIG.WEIGHT_RECENT);
  const markovPreds = predictWithMarkov(sequence, model);
  
  // 2. Phân tích pattern
  const patternAnalysis = analyzePattern(sequence);
  
  // 3. Thống kê tần suất
  const freq = {};
  for (const ch of sequence) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  const totalFreq = sequence.length;
  const freqPred = Object.entries(freq)
    .map(([ch, count]) => ({
      char: ch,
      confidence: count / totalFreq,
      samples: count,
      method: 'frequency'
    }))
    .sort((a, b) => b.confidence - a.confidence);
  
  // 4. So sánh với các bàn khác (global)
  const globalFreq = {};
  for (const ch of allResults) {
    globalFreq[ch] = (globalFreq[ch] || 0) + 1;
  }
  const globalTotal = allResults.length;
  const globalPred = Object.entries(globalFreq)
    .map(([ch, count]) => ({
      char: ch,
      confidence: count / globalTotal,
      samples: count,
      method: 'global'
    }))
    .sort((a, b) => b.confidence - a.confidence);
  
  // 5. Kết hợp tất cả với trọng số
  const combined = {};
  const weights = {
    markov: 0.5,
    pattern: 0.2,
    frequency: 0.15,
    global: 0.15
  };
  
  // Từ Markov (ưu tiên bậc cao nhất)
  if (markovPreds.length > 0) {
    const best = markovPreds[0];
    combined[best.char] = (combined[best.char] || 0) + best.confidence * weights.markov;
  }
  
  // Từ pattern
  if (patternAnalysis) {
    const patternChar = patternAnalysis.xu_huong === 'Bệt' ? sequence[sequence.length-1] : 
                       (sequence[sequence.length-1] === 'B' ? 'P' : 'B');
    const patternConf = Math.abs(patternAnalysis.ty_le_bet - 0.5) * 2;
    combined[patternChar] = (combined[patternChar] || 0) + patternConf * weights.pattern;
  }
  
  // Từ frequency
  if (freqPred.length > 0) {
    const best = freqPred[0];
    combined[best.char] = (combined[best.char] || 0) + best.confidence * weights.frequency;
  }
  
  // Từ global
  if (globalPred.length > 0) {
    const best = globalPred[0];
    combined[best.char] = (combined[best.char] || 0) + best.confidence * weights.global;
  }
  
  // Chọn dự đoán cuối cùng
  let finalPred = null, maxScore = 0;
  for (const [ch, score] of Object.entries(combined)) {
    if (score > maxScore) {
      maxScore = score;
      finalPred = ch;
    }
  }
  
  // Tìm confidence tương ứng
  let finalConfidence = 0;
  if (markovPreds.length > 0) {
    const best = markovPreds[0];
    if (best.char === finalPred) finalConfidence = best.confidence;
  }
  if (finalConfidence === 0 && freqPred.length > 0) {
    const best = freqPred[0];
    if (best.char === finalPred) finalConfidence = best.confidence;
  }
  
  return {
    prediction: finalPred,
    confidence: finalConfidence,
    method: 'hybrid',
    markovPredictions: markovPreds,
    frequencyPrediction: freqPred[0],
    globalPrediction: globalPred[0],
    patternAnalysis: patternAnalysis,
    combinedScores: combined,
    recommend: finalConfidence >= CONFIG.CONFIDENCE_THRESHOLD ? 'Có thể đánh' : 'Cần thận trọng'
  };
}

// ==================== ĐÁNH GIÁ ĐỘ CHÍNH XÁC ====================
function evaluateAccuracy(sequence, maxOrder = CONFIG.MAX_ORDER) {
  if (sequence.length < CONFIG.MIN_SEQUENCE_LENGTH) return 0;
  
  let correct = 0, total = 0;
  const minLength = CONFIG.MIN_SEQUENCE_LENGTH;
  
  for (let i = minLength; i < sequence.length - 1; i++) {
    const trainSeq = sequence.slice(0, i);
    const model = buildMarkovModel(trainSeq, maxOrder, CONFIG.WEIGHT_RECENT);
    const preds = predictWithMarkov(trainSeq, model, maxOrder);
    
    if (preds.length > 0) {
      const predChar = preds[0].char;
      const actual = sequence[i];
      if (predChar === actual) correct++;
      total++;
    }
  }
  return total > 0 ? correct / total : 0;
}

// ==================== API ENDPOINT ====================
app.get('/predict', async (req, res) => {
  try {
    const tables = await fetchBaccaratData();
    const allResults = tables.map(t => t.result).join('');
    
    // Dự đoán cho từng bàn
    const tablePredictions = {};
    for (const table of tables) {
      const seq = table.result;
      if (seq.length < CONFIG.MIN_SEQUENCE_LENGTH) {
        tablePredictions[table.table] = { error: 'Chuỗi quá ngắn để dự đoán' };
        continue;
      }
      
      // Dùng hybrid prediction
      const pred = hybridPrediction(seq, tables, allResults);
      tablePredictions[table.table] = {
        table_name: table.table,
        total_rounds: seq.length,
        next_round: seq.length + 1,
        prediction: pred.prediction,
        confidence: pred.confidence,
        confidence_percent: (pred.confidence * 100).toFixed(1) + '%',
        method: pred.method,
        recommend: pred.recommend,
        pattern_analysis: pred.patternAnalysis,
        markov_predictions: pred.markovPredictions.slice(0, 3),
        frequency: pred.frequencyPrediction,
        global_trend: pred.globalPrediction,
        combined_scores: pred.combinedScores
      };
    }
    
    // Dự đoán gộp
    const globalPred = hybridPrediction(allResults, tables, allResults);
    const combinedPred = {
      prediction: globalPred.prediction,
      confidence: globalPred.confidence,
      confidence_percent: (globalPred.confidence * 100).toFixed(1) + '%',
      method: globalPred.method,
      recommend: globalPred.recommend,
      total_rounds: allResults.length,
      pattern_analysis: globalPred.patternAnalysis
    };
    
    // Dự đoán 34 ván cuối
    const n = Math.min(CONFIG.DEFAULT_LAST_N, allResults.length);
    const lastNSeq = allResults.slice(-n);
    const lastNPred = hybridPrediction(lastNSeq, tables, allResults);
    const lastN = {
      n_rounds: n,
      sequence: lastNSeq,
      prediction: lastNPred.prediction,
      confidence: lastNPred.confidence,
      confidence_percent: (lastNPred.confidence * 100).toFixed(1) + '%',
      recommend: lastNPred.recommend,
      next_round: n + 1
    };
    
    // Đánh giá độ chính xác trung bình
    let accuracies = [];
    for (const table of tables) {
      const acc = evaluateAccuracy(table.result);
      if (acc > 0) accuracies.push(acc);
    }
    const avgAccuracy = accuracies.length > 0 
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length 
      : 0;
    
    // Phân tích global pattern
    const globalPattern = analyzePattern(allResults);
    
    // Trả về kết quả
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      summary: {
        total_tables: tables.length,
        total_rounds: allResults.length,
        average_accuracy: avgAccuracy,
        global_pattern: globalPattern
      },
      predictions: {
        per_table: tablePredictions,
        combined: combinedPred,
        last_n: lastN
      },
      config: {
        max_order: CONFIG.MAX_ORDER,
        confidence_threshold: CONFIG.CONFIDENCE_THRESHOLD,
        weight_recent: CONFIG.WEIGHT_RECENT,
        recent_count: CONFIG.RECENT_COUNT
      }
    });
    
  } catch (error) {
    console.error('Lỗi server:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== ENDPOINT ĐƠN GIẢN ====================
app.get('/', (req, res) => {
  res.json({
    service: 'Baccarat Predictor',
    version: '2.0',
    endpoints: {
      '/predict': 'Dự đoán chi tiết',
      '/predict/simple': 'Dự đoán đơn giản (text)'
    }
  });
});

app.get('/predict/simple', async (req, res) => {
  try {
    const tables = await fetchBaccaratData();
    let text = 'DỰ ĐOÁN BACCARAT\n';
    text += '==================\n\n';
    
    for (const table of tables) {
      const seq = table.result;
      if (seq.length < CONFIG.MIN_SEQUENCE_LENGTH) continue;
      
      const pred = hybridPrediction(seq, tables, tables.map(t => t.result).join(''));
      text += `Bàn ${table.table.padEnd(4)} | Phiên ${(seq.length+1).toString().padEnd(3)} | Dự đoán: ${pred.prediction} | Độ tin cậy: ${(pred.confidence*100).toFixed(1)}% | ${pred.recommend}\n`;
    }
    
    // Dự đoán gộp
    const allResults = tables.map(t => t.result).join('');
    const globalPred = hybridPrediction(allResults, tables, allResults);
    text += `\nGỘP TẤT CẢ | Phiên ${(allResults.length+1).toString().padEnd(3)} | Dự đoán: ${globalPred.prediction} | Độ tin cậy: ${(globalPred.confidence*100).toFixed(1)}% | ${globalPred.recommend}\n`;
    
    // 34 ván cuối
    const n = Math.min(CONFIG.DEFAULT_LAST_N, allResults.length);
    const lastNSeq = allResults.slice(-n);
    const lastNPred = hybridPrediction(lastNSeq, tables, allResults);
    text += `\n34 VÁN CUỐI | Phiên ${(n+1).toString().padEnd(3)} | Dự đoán: ${lastNPred.prediction} | Độ tin cậy: ${(lastNPred.confidence*100).toFixed(1)}% | ${lastNPred.recommend}\n`;
    
    res.send(text);
  } catch (error) {
    res.status(500).send('Lỗi: ' + error.message);
  }
});

// ==================== KHỞI ĐỘNG SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Baccarat Predictor Server đang chạy trên port ${PORT}`);
  console.log(`📊 Endpoint: http://localhost:${PORT}/predict`);
  console.log(`📝 Simple: http://localhost:${PORT}/predict/simple`);
});
