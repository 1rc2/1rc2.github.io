// Vercel Function：管理后台密码验证
// 部署后在 Vercel 后台 Settings → Environment Variables 设置 ADMIN_PASSWORD
//
// 环境变量：
//   ADMIN_PASSWORD   必填，管理后台登录密码
//   ALLOWED_ORIGIN   可选，允许的前端域名，默认 * （生产建议改为你自己的域名）
//   ADMIN_SESSION_TTL 可选，会话有效期（秒），默认 86400（1天）

export const runtime = "nodejs";

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

// 简单的会话 token 生成：base64(时间戳.签名)
// 签名用 ADMIN_PASSWORD 作为密钥，HMAC-SHA256
async function makeToken(password, ttl) {
  const expireAt = Date.now() + ttl * 1000;
  const payload = String(expireAt);
  const enc = new TextEncoder();
  const keyData = enc.encode(password);
  const key = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigB64 = Buffer.from(sig).toString("base64url");
  return Buffer.from(payload).toString("base64url") + "." + sigB64;
}

async function verifyToken(token, password) {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return false;
    const expireAt = parseInt(Buffer.from(payloadB64, "base64url").toString(), 10);
    if (!expireAt || expireAt < Date.now()) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sig = Buffer.from(sigB64, "base64url");
    return await crypto.subtle.verify("HMAC", key, sig, enc.encode(String(expireAt)));
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
    const token = await makeToken(password, ttl);
    return new Response(
      JSON.stringify({ ok: true, token, expireIn: ttl }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(allow) } }
    );
  }

  // 其他操作需要携带有效 token
  const token = body.token;
  if (!token || !(await verifyToken(token, password))) {
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
