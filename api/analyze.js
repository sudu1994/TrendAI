const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY);

async function fetchTrendData(keyword) {
  const params = {
    engine: "google_trends",
    q: keyword,
    date: "today 12-m",
    geo: "JP",
    hl: "ja",
    api_key: process.env.SERPAPI_KEY,
  };

  const res = await axios.get("https://serpapi.com/search.json", { params });
  const timeline = res.data?.interest_over_time?.timeline_data ?? [];
  if (timeline.length === 0) throw new Error("トレンドデータが見つかりませんでした。");

  const values = timeline.map((d) => ({
    date: d.date,
    value: Number(d.values?.[0]?.extracted_value ?? 0),
  }));

  const avg = values.reduce((s, d) => s + d.value, 0) / values.length;
  const recent = values.slice(-4);
  const recentAvg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const trend =
    recentAvg > avg * 1.1 ? "📈 上昇中" :
    recentAvg < avg * 0.9 ? "📉 下降中" : "➡️ 安定";

  const rising = res.data?.related_queries?.rising?.slice(0, 5).map((q) => q.query) ?? [];
  const top    = res.data?.related_queries?.top?.slice(0, 5).map((q) => q.query) ?? [];

  return {
    keyword,
    values,
    avg: Math.round(avg),
    recentAvg: Math.round(recentAvg),
    trend,
    score: Math.round(recentAvg),
    rising,
    top,
  };
}

async function generatePlanAndSite(trendData) {
  const { keyword, trend, score, avg, recentAvg, rising, top } = trendData;

  // Using Gemini 3 Flash (Free Tier)
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3-flash-preview",
    generationConfig: { 
      responseMimeType: "application/json",
      temperature: 0.7 
    }
  });

  const systemPrompt = `あなたはTrendBaseAIのアナリストです。
Googleトレンドデータを元に、ビジネスプランとTailwind CSSを使用したHTMLウェブサイトを日本語で生成します。
必ず純粋なJSON形式のみで返答してください。余計な解説文などは一切不要です。`;

  const userPrompt = `
キーワード: "${keyword}"
トレンド: ${trend}
スコア: ${score}

以下のJSONを生成してください：
{
  "businessPlan": {
    "title": "ビジネス名",
    "tagline": "キャッチコピー",
    "opportunity": "理由",
    "target": "顧客像",
    "service": "概要",
    "differentiation": ["P1", "P2", "P3"],
    "seoKeywords": ["W1", "W2"],
    "revenueModel": "収益モデル",
    "actionPlan": ["S1", "S2"],
    "risk": "対策"
  },
  "websiteHTML": "<!DOCTYPE html><html>...</html>"
}
重要：返答は必ずJSONの閉じカッコ '}' で終了させてください。`;

  const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
  const response = await result.response;
  const fullText = response.text();
  
  // Robust Cleaning: Remove Markdown and cut off any "chatty" text after the JSON
  let cleaned = fullText.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  const lastBraceIndex = cleaned.lastIndexOf("}");
  if (lastBraceIndex !== -1) {
    cleaned = cleaned.substring(0, lastBraceIndex + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("JSON Parse Error:", err);
    throw new Error("AIの応答が正しくありませんでした。");
  }
}

module.exports = async (req, res) => {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const keyword = req.query.keyword?.trim();
  if (!keyword) {
    return res.status(400).json({ error: "キーワードを入力してください。" });
  }

  try {
    const trendData = await fetchTrendData(keyword);
    const aiResult  = await generatePlanAndSite(trendData);
    return res.status(200).json({ trend: trendData, result: aiResult });
  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message || "内部サーバーエラー" });
  }
};
