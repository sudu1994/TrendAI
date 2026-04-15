const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini (Free Tier)
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

  // Use Gemini 1.5 Flash - Fast and Free
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" } 
  });

  const systemPrompt = `あなたはTrendBaseAIのAIアナリストです。
Googleトレンドデータを元に、起業家・副業志望者向けの実用的なビジネスプランと
完全なHTMLウェブサイトを日本語で生成します。
必ずJSON形式のみで返答してください。余分なテキストは一切不要です。`;

  const userPrompt = `
# Googleトレンドデータ
キーワード: "${keyword}"
トレンド方向: ${trend}
現在スコア: ${score}/100（過去12ヶ月平均: ${avg}）
直近4週平均: ${recentAvg}
急上昇関連ワード: ${rising.join(", ") || "なし"}
人気関連ワード: ${top.join(", ") || "なし"}

# タスク
以下のJSONを生成してください：
{
  "businessPlan": {
    "title": "ビジネス名（キャッチーで覚えやすい）",
    "tagline": "15文字以内のキャッチコピー",
    "opportunity": "なぜ今このビジネスがチャンスなのか（3文）",
    "target": "ターゲット顧客像（具体的に2文）",
    "service": "提供するサービス・商品の概要（3文）",
    "differentiation": "競合との差別化ポイント（3箇条）",
    "seoKeywords": ["SEOキーワード×8個"],
    "revenueModel": "収益モデルの説明（2文）",
    "actionPlan": ["今すぐできるアクション×5ステップ"],
    "risk": "主なリスクと対策（2文）"
  },
  "websiteHTML": "完全なHTML文書（<!DOCTYPE html>から</html>まで）。Tailwind CDNを使い、モダンでプロフェッショナルなデザイン。"
}`;

  const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
  const response = await result.response;
  const fullText = response.text();
  
  // Clean potentially backticked JSON
  const cleaned = fullText.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  return JSON.parse(cleaned);
}

module.exports = async (req, res) => {
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
    console.error(err);
    return res.status(500).json({ error: err.message || "サーバーエラーが発生しました。" });
  }
};
