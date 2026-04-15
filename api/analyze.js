const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. Initialize with the key from Vercel Environment Variables
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

  // 2. Using Gemini 3 Flash (Current stable free-tier model in 2026)
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3-flash-preview",
    generationConfig: { 
      responseMimeType: "application/json",
      temperature: 0.7 
    }
  });

  const systemPrompt = `あなたはTrendBaseAIのアナリストです。
Googleトレンドデータを元に、ビジネスプランとTailwind CSSを使用したHTMLウェブサイトを日本語で生成します。
必ず純粋なJSON形式のみで返答してください。`;

  const userPrompt = `
キーワード: "${keyword}"
トレンド: ${trend}
スコア: ${score}
関連ワード: ${rising.join(", ")}

以下のJSONを生成してください：
{
  "businessPlan": {
    "title": "ビジネス名",
    "tagline": "キャッチコピー",
    "opportunity": "理由",
    "target": "顧客像",
    "service": "概要",
    "differentiation": ["ポイント1", "2", "3"],
    "seoKeywords": ["word1", "word2"],
    "revenueModel": "収益モデル",
    "actionPlan": ["Step1", "Step2"],
    "risk": "対策"
  },
  "websiteHTML": "<!DOCTYPE html>...</html>"
}`;

  const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
  const response = await result.response;
  const fullText = response.text();
  
  // 3. Robust JSON cleaning to prevent "Unexpected token" errors
  const cleaned = fullText.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  return JSON.parse(cleaned);
}

module.exports = async (req, res) => {
  // CORS setup
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
    console.error("Server Error:", err);
    return res.status(500).json({ error: err.message || "内部サーバーエラー" });
  }
};
