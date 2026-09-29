// Vercel Edge Function：代理 DeepSeek API，隐藏 API key
// 部署后在 Vercel 后台 Settings → Environment Variables 设置 DEEPSEEK_API_KEY
//
// 环境变量：
//   DEEPSEEK_API_KEY  必填，DeepSeek 的 sk-xxx key
//   ALLOWED_ORIGIN    可选，允许的前端域名，默认 * （生产建议改为你自己的域名）

export const config = { runtime: "edge" };

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

export default async function handler(req) {
  const allow = process.env.ALLOWED_ORIGIN || "*";

  // CORS 预检
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "仅支持 POST" }),
      { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "服务器未配置 DEEPSEEK_API_KEY 环境变量" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  let body;
  try { body = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ error: "请求体不是合法 JSON" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  // 仅透传 messages，model/max_tokens 在这里强制，前端无法越权
  const messages = Array.isArray(body.messages) ? body.messages : [];

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        max_tokens: 800,
        stream: false
      })
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(allow) }
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "上游请求失败: " + (e.message || String(e)) }),
      { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }
}
