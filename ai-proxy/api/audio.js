// Vercel Function：音频跨域代理
// 用途：浏览器直接 fetch 第三方音频会被 CORS 拦截，走这里由服务端转发
//
// 使用：GET /api/audio?url=<encodeURIComponent(音频地址)>
// 前端「高级：自定义 CORS 代理」填 https://你的项目.vercel.app/api/audio?url=
//
// 环境变量：
//   ALLOWED_ORIGIN  可选，允许的前端域名，默认 *
//   MAX_AUDIO_MB    可选，单个音频大小上限（MB），默认 60

export const runtime = "nodejs";

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  };
}

// 简单 SSRF 防护：禁止内网/本机地址
function isBlocked(host){
  const h = (host || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "0.0.0.0" || h === "[::1]") return true;
  return false;
}

export default async function handler(req){
  const allow = process.env.ALLOWED_ORIGIN || "*";

  if (req.method === "OPTIONS"){
    return new Response(null, { status: 204, headers: cors(allow) });
  }
  if (req.method !== "GET"){
    return new Response(JSON.stringify({ error: "仅支持 GET" }), {
      status: 405, headers: { "Content-Type": "application/json", ...cors(allow) },
    });
  }

  const reqUrl = new URL(req.url, "https://placeholder.local");
  const target = reqUrl.searchParams.get("url");
  if (!target){
    return new Response(JSON.stringify({ error: "缺少 url 参数" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors(allow) },
    });
  }

  let u;
  try { u = new URL(target); }
  catch (e){
    return new Response(JSON.stringify({ error: "url 不是合法地址" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors(allow) },
    });
  }
  if (!/^https?:$/.test(u.protocol) || isBlocked(u.hostname)){
    return new Response(JSON.stringify({ error: "不允许的地址" }), {
      status: 403, headers: { "Content-Type": "application/json", ...cors(allow) },
    });
  }

  const maxBytes = (parseInt(process.env.MAX_AUDIO_MB) || 60) * 1024 * 1024;

  try {
    const upstream = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ListeningTrainer/1.0)",
        "Accept": "audio/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!upstream.ok){
      return new Response(JSON.stringify({ error: "上游返回 " + upstream.status }), {
        status: upstream.status, headers: { "Content-Type": "application/json", ...cors(allow) },
      });
    }

    const len = parseInt(upstream.headers.get("content-length") || "0", 10);
    if (len && len > maxBytes){
      return new Response(JSON.stringify({ error: `音频过大（${(len/1048576).toFixed(1)}MB，上限 ${maxBytes/1048576}MB）` }), {
        status: 413, headers: { "Content-Type": "application/json", ...cors(allow) },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        ...(len ? { "Content-Length": String(len) } : {}),
        "Cache-Control": "public, max-age=3600",
        ...cors(allow),
      },
    });
  } catch (e){
    return new Response(JSON.stringify({ error: "上游请求失败: " + (e.message || String(e)) }), {
      status: 502, headers: { "Content-Type": "application/json", ...cors(allow) },
    });
  }
}
