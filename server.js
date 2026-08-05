// server.js - Baccarat Prediction API for Render
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- CẤU HÌNH --------------------
const API_URL = 'https://liichubc.onrender.com/api/baccarat';
const MAX_ORDER = 3; // Bậc Markov tối đa
const DEFAULT_LAST_N = 34;

// -------------------- HÀM LẤY DỮ LIỆU --------------------
async function fetchBaccaratData() {
  const response = await fetch(API_URL);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Dữ liệu không đúng định dạng');
  }
  return data.data; // mảng các bàn
}

// -------------------- MÔ HÌNH MARKOV --------------------
/**
 * Xây dựng mô hình Markov đa bậc từ chuỗi kết quả
 * @param {string} sequence - Chuỗi ký tự (B, P, T)
 * @param {number} maxOrder - Bậc tối đa
 * @returns {Object} model[order] = { pattern: { nextChar: count } }
 */
function buildMarkovModel(sequence, maxOrder = MAX_ORDER) {
  const model = {};
  for (let order = 1; order <= maxOrder; order++) {
    if (sequence.length <= order) continue;
    const trans = {};
    for (let i = 0; i < sequence.length - order; i++) {
      const pat = sequence.slice(i, i + order);
      const nxt = sequence[i + order];
      if (!trans[pat]) trans[pat] = {};
      trans[pat][nxt] = (trans[pat][nxt] || 0) + 1;
    }
    model[order] = trans;
  }
  return model;
}

/**
 * Dự đoán ký tự tiếp theo dựa trên mô hình Markov
 * @param {string} sequence - Chuỗi hiện tại
 * @param {Object} model - Mô hình Markov đã xây dựng
 * @param {number} maxOrder - Bậc tối đa
 * @returns {Array} Mảng các dự đoán từ bậc cao xuống thấp, mỗi phần tử: { char, confidence, samples, order }
 */
function predictWithMarkov(sequence, model, maxOrder = MAX_ORDER) {
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
          order: order
        });
      }
    }
  }
  return predictions;
}

/**
 * Dự đoán fallback: dùng tần suất xuất hiện tổng thể
 */
function fallbackPrediction(sequence) {
  const counter = {};
  for (const ch of sequence) {
    counter[ch] = (counter[ch] || 0) + 1;
  }
  let maxChar = null, maxCount = 0;
  for (const [ch, count] of Object.entries(counter)) {
    if (count > maxCount) {
      maxCount = count;
      maxChar = ch;
    }
  }
  if (maxChar) {
    return {
      prediction: maxChar,
      confidence: maxCount / sequence.length,
      method: 'global_freq',
      samples: sequence.length
    };
  }
  return null;
}

// -------------------- DỰ ĐOÁN CHO BÀN RIÊNG LẺ --------------------
function predictTable(tableName, tables, tableStats, maxOrder = MAX_ORDER) {
  if (!tableStats[tableName]) return { error: 'Bàn không tồn tại' };
  const seq = tables.find(t => t.table === tableName)?.result || '';
  if (seq.length < 2) return { error: 'Chuỗi quá ngắn' };
  const stats = tableStats[tableName];
  const preds = predictWithMarkov(seq, stats.model, maxOrder);
  if (preds.length === 0) {
    const fallback = fallbackPrediction(seq);
    return fallback ? { ...fallback, method: 'fallback_freq' } : { error: 'Không đủ dữ liệu' };
  }
  const best = preds[0];
  return {
    prediction: best.char,
    confidence: best.confidence,
    method: `Markov_order_${best.order}`,
    samples: best.samples,
    allPredictions: preds
  };
}

// -------------------- DỰ ĐOÁN GỘP --------------------
function predictCombined(allResults, globalModel, maxOrder = MAX_ORDER) {
  if (allResults.length < 2) return { error: 'Chuỗi quá ngắn' };
  const preds = predictWithMarkov(allResults, globalModel, maxOrder);
  if (preds.length === 0) {
    const fallback = fallbackPrediction(allResults);
    return fallback ? { ...fallback, method: 'fallback_freq' } : { error: 'Không đủ dữ liệu' };
  }
  const best = preds[0];
  return {
    prediction: best.char,
    confidence: best.confidence,
    method: `Markov_order_${best.order}`,
    samples: best.samples,
    allPredictions: preds
  };
}

// -------------------- DỰ ĐOÁN N VÁN CUỐI --------------------
function predictLastN(allResults, n, maxOrder = MAX_ORDER) {
  if (allResults.length < n) n = allResults.length;
  const seq = allResults.slice(-n);
  if (seq.length < 2) return { error: 'Chuỗi quá ngắn' };
  const model = buildMarkovModel(seq, maxOrder);
  const preds = predictWithMarkov(seq, model, maxOrder);
  if (preds.length === 0) {
    const fallback = fallbackPrediction(seq);
    return fallback ? { ...fallback, method: 'fallback_freq_local' } : { error: 'Không đủ dữ liệu' };
  }
  const best = preds[0];
  return {
    prediction: best.char,
    confidence: best.confidence,
    method: `Markov_order_${best.order}_local`,
    samples: best.samples,
    allPredictions: preds
  };
}

// -------------------- THỐNG KÊ CẦU --------------------
function getCauStatistics(sequence) {
  if (sequence.length < 2) return {};
  let bệt = 0, đảo = 0;
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i] === sequence[i+1]) bệt++;
    else đảo++;
  }
  const counter = {};
  for (const ch of sequence) counter[ch] = (counter[ch] || 0) + 1;
  return {
    bệt,
    đảo,
    tyLeBet: sequence.length > 1 ? bệt / (sequence.length - 1) : 0,
    tyLeDao: sequence.length > 1 ? đảo / (sequence.length - 1) : 0,
    tanSo: counter
  };
}

// -------------------- ĐÁNH GIÁ ĐỘ CHÍNH XÁC (LEAVE-ONE-OUT) --------------------
function evaluateAccuracy(sequence, maxOrder = MAX_ORDER) {
  if (sequence.length < 3) return 0;
  let correct = 0, total = 0;
  for (let i = 2; i < sequence.length - 1; i++) {
    const trainSeq = sequence.slice(0, i);
    const model = buildMarkovModel(trainSeq, maxOrder);
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

// -------------------- API ENDPOINT CHÍNH --------------------
app.get('/predict', async (req, res) => {
  try {
    const tables = await fetchBaccaratData();
    const allResults = tables.map(t => t.result).join('');

    // 1. Huấn luyện mô hình cho từng bàn
    const tableStats = {};
    for (const table of tables) {
      const seq = table.result;
      if (seq.length >= 2) {
        const model = buildMarkovModel(seq, MAX_ORDER);
        const total = {};
        for (const ch of seq) total[ch] = (total[ch] || 0) + 1;
        tableStats[table.table] = { model, total, length: seq.length };
      }
    }

    // 2. Huấn luyện mô hình gộp
    const globalModel = buildMarkovModel(allResults, MAX_ORDER);

    // 3. Dự đoán cho từng bàn
    const tablePredictions = {};
    for (const table of tables) {
      const name = table.table;
      const pred = predictTable(name, tables, tableStats, MAX_ORDER);
      tablePredictions[name] = pred;
    }

    // 4. Dự đoán gộp
    const combinedPred = predictCombined(allResults, globalModel, MAX_ORDER);

    // 5. Dự đoán 34 ván cuối
    const n = Math.min(DEFAULT_LAST_N, allResults.length);
    const lastNPred = predictLastN(allResults, n, MAX_ORDER);

    // 6. Đánh giá độ chính xác trung bình
    let accuracies = [];
    for (const table of tables) {
      const acc = evaluateAccuracy(table.result, MAX_ORDER);
      if (acc > 0) accuracies.push(acc);
    }
    const avgAccuracy = accuracies.length > 0 
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length 
      : 0;

    // 7. Thống kê cầu cho bàn C01 (có thể thay đổi)
    const c01Seq = tables.find(t => t.table === 'C01')?.result || '';
    const cauC01 = getCauStatistics(c01Seq);

    // 8. Trả về kết quả JSON
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      totalTables: tables.length,
      totalRounds: allResults.length,
      tablePredictions,
      combinedPrediction: combinedPred,
      lastN: {
        n: n,
        lastSequence: allResults.slice(-n),
        prediction: lastNPred
      },
      averageAccuracy: avgAccuracy,
      cauStatistics: {
        C01: cauC01
      }
    });

  } catch (error) {
    console.error('Lỗi:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// -------------------- KHỞI ĐỘNG SERVER --------------------
app.listen(PORT, () => {
  console.log(`✅ Baccarat Predictor đang chạy trên port ${PORT}`);
  console.log(`📊 Truy cập http://localhost:${PORT}/predict để lấy dự đoán`);
});
