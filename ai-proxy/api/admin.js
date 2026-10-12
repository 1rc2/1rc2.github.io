// Vercel Function：管理后台密码验证
// 部署后在 Vercel 后台 Settings → Environment Variables 设置 ADMIN_PASSWORD
//
// 环境变量：
//   ADMIN_PASSWORD   必填，管理后台登录密码
//   ALLOWED_ORIGIN    可选，允许的前端域名，默认 * （生产建议改为你自己的域名）
//   ADMIN_SESSION_TTL 可选，会话有效期（秒），默认 86400（1天）

export const runtime = "nodejs";

import crypto from "crypto";

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

// 会话 token：base64url(时间戳) + "." + base64url(HMAC-SHA256(时间戳, 密码))
function makeToken(password, ttl) {
  const expireAt = Date.now() + ttl * 1000;
  const payload = String(expireAt);
  const sig = crypto.createHmac("sha256", password).update(payload).digest("base64url");
  return Buffer.from(payload).toString("base64url") + "." + sig;
}

function verifyToken(token, password) {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return false;
    const expireAt = parseInt(Buffer.from(payloadB64, "base64url").toString(), 10);
    if (!expireAt || expireAt < Date.now()) return false;
    const expected = crypto
      .createHmac("sha256", password)
      .update(String(expireAt))
      .digest("base64url");
    // 恒定时间比较，防止时序攻击
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

export default async function handler(req) {
  const allow = process.env.ALLOWED_ORIGIN || "*";
  const password = process.env.ADMIN_PASSWORD;

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
  if (!password) {
    return new Response(
      JSON.stringify({ error: "服务器未配置 ADMIN_PASSWORD 环境变量" }),
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

  const action = body.action || "login";

  // 登录：验证密码，返回会话 token
  if (action === "login") {
    if (body.password !== password) {
      return new Response(
        JSON.stringify({ error: "密码错误" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
      );
    }
    const ttl = parseInt(process.env.ADMIN_SESSION_TTL) || 86400;
    const token = makeToken(password, ttl);
    return new Response(
      JSON.stringify({ ok: true, token, expireIn: ttl }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  // 其他操作需要携带有效 token
  const token = body.token;
  if (!token || !verifyToken(token, password)) {
    return new Response(
      JSON.stringify({ error: "未登录或会话已过期" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  // 校验 token（无需返回数据，仅确认有效）
  if (action === "verify") {
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  return new Response(
    JSON.stringify({ error: "未知操作: " + action }),
    { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
  );
}
