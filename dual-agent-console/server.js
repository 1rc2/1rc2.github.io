'use strict';
/*
 * 双 Agent 控制台后端：编排 Trae CLI 与 Qoder CLI
 *
 * 启动：
 *   node server.js                 真实模式（需已安装并登录 traecli / qoder）
 *   MOCK=1 node server.js          预览模式（不依赖 CLI，输出模拟内容）
 *
 * 环境变量：
 *   PORT            默认 3210
 *   WORKSPACE       两个 Agent 共同操作的目录，默认 ./runs（会自动 git init）
 *   TRAE_CMD        默认 traecli（实际执行: traecli exec "<prompt>"）
 *   QODER_CMD       默认 qoder（实际执行: qoder run "<prompt>"）
 *   STEP_TIMEOUT_MS 单步超时，默认 10 分钟
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = Number(process.env.PORT || 3210);
const WORKSPACE = path.resolve(process.env.WORKSPACE || path.join(__dirname, 'runs'));
const MOCK = process.env.MOCK === '1';
const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS || 10 * 60 * 1000);
const TAIL_CHARS = 4000; // 接力时带给对方的上一轮输出上限

const AGENTS = {
  trae: { name: 'Trae', cmd: process.env.TRAE_CMD || 'traecli', args: p => ['exec', p] },
  qoder: { name: 'Qoder', cmd: process.env.QODER_CMD || 'qoder', args: p => ['run', p] },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const PUBLIC_DIR = path.join(__dirname, 'public');

function ensureWorkspace() {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  if (!MOCK && !fs.existsSync(path.join(WORKSPACE, '.git'))) {
    try {
      execSync('git init', { cwd: WORKSPACE, stdio: 'ignore' });
    } catch { /* git 不可用也不阻塞 */ }
  }
}

const tail = (s, n) => (s.length > n ? s.slice(-n) : s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- CLI 执行 ----------

function runAgent(agentKey, prompt, { onOut, signal }) {
  if (MOCK) return runMock(agentKey, prompt, { onOut, signal });
  const agent = AGENTS[agentKey];
  return new Promise((resolve, reject) => {
    const child = spawn(agent.cmd, agent.args(prompt), { cwd: WORKSPACE, env: process.env });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${agent.name} 超时（${STEP_TIMEOUT_MS / 60000} 分钟）`));
    }, STEP_TIMEOUT_MS);
    const onData = b => {
      const s = b.toString();
      out += s;
      onOut(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', e => {
      clearTimeout(timer);
      reject(new Error(`无法启动 ${agent.cmd}：${e.message}（确认已安装并登录；或先用 MOCK=1 预览）`));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (signal.aborted) return reject(new Error('已手动停止'));
      if (code === 0) resolve(out);
      else reject(new Error(`${agent.name} 退出码 ${code}`));
    });
    signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
  });
}

async function runMock(agentKey, prompt, { onOut, signal }) {
  const name = AGENTS[agentKey].name;
  const first = prompt.split('\n')[0].slice(0, 40);
  const lines = [
    `[mock] ${name} 收到任务：${first}${prompt.length > 40 ? '…' : ''}`,
    `[mock] ${name} 正在分析工作区…`,
    `[mock] ${name} 生成方案并修改代码…`,
    `[mock] ${name} 完成：已写入变更（模拟输出；安装 CLI 后去掉 MOCK 即真实执行）`,
  ];
  let out = '';
  for (const line of lines) {
    if (signal.aborted) throw new Error('已手动停止');
    await sleep(500);
    out += line + '\n';
    onOut(line + '\n');
  }
  return out;
}

// ---------- 编排 ----------

function buildRelayPrompt(task, lastAgentName, lastOutput) {
  return [
    `任务背景：${task}`,
    '',
    `另一个 AI 工程师（${lastAgentName}）刚在同一工作区完成了上一轮工作，它的说明如下：`,
    '---',
    tail(lastOutput, TAIL_CHARS),
    '---',
    '请你审查工作区中的实际代码：能直接修复的问题请动手修复，暂不改动的地方给出明确意见；最后输出你的结论。',
  ].join('\n');
}

async function orchestrate({ task, mode, maxRounds }, send, signal) {
  const step = async (agentKey, prompt, label) => {
    send({ type: 'step', agent: agentKey, label });
    try {
      return await runAgent(agentKey, prompt, {
        signal,
        onOut: text => send({ type: 'out', agent: agentKey, text }),
      });
    } catch (e) {
      send({ type: 'error', agent: agentKey, text: e.message });
      throw e;
    }
  };

  if (mode === 'parallel') {
    const prompt = `${task}\n\n（请直接在当前工作区中修改代码完成任务，并在最后说明你做了什么。）`;
    await Promise.all([
      step('trae', prompt, '并行执行').catch(() => ''),
      step('qoder', prompt, '并行执行').catch(() => ''),
    ]);
    return;
  }

  // 接力：trae -> qoder -> trae -> qoder ... 共 maxRounds 轮
  const order = ['trae', 'qoder'];
  let lastAgent = null;
  let lastOutput = '';
  for (let i = 0; i < maxRounds * 2; i++) {
    const agentKey = order[i % 2];
    const prompt =
      i === 0
        ? `${task}\n\n（请直接在当前工作区中修改代码完成任务，并在最后给出你做了什么、遗留什么问题。）`
        : buildRelayPrompt(task, AGENTS[lastAgent].name, lastOutput);
    lastOutput = await step(agentKey, prompt, i === 0 ? '首轮执行' : `接力第 ${i + 1} 棒`);
    lastAgent = agentKey;
  }
}

// ---------- HTTP ----------

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function handleRun(req, res) {
  let body = '';
  req.on('data', c => {
    body += c;
    if (body.length > 64 * 1024) req.destroy();
  });
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      return res.end('bad json');
    }
    const task = String(payload.task || '').trim();
    const mode = payload.mode === 'relay' ? 'relay' : 'parallel';
    const maxRounds = Math.min(Math.max(parseInt(payload.maxRounds, 10) || 2, 1), 5);
    if (!task) {
      res.writeHead(400);
      return res.end('task required');
    }

    ensureWorkspace();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = ev => {
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch { /* 客户端已断开 */ }
    };
    const ac = new AbortController();
    let finished = false;
    // req 的 close 在请求体读完就会触发，必须用 res 的 close 判断客户端断开
    res.on('close', () => {
      if (!finished) ac.abort();
    });

    send({
      type: 'info',
      text: `模式：${mode === 'relay' ? `接力协作（${maxRounds} 轮）` : '并行对比'} · 工作区：${WORKSPACE}${MOCK ? ' · MOCK 预览' : ''}`,
    });
    try {
      await orchestrate({ task, mode, maxRounds }, send, ac.signal);
      send({ type: 'done', text: '全部完成' });
    } catch (e) {
      send({ type: 'done', text: ac.signal.aborted ? '已手动停止' : `中断：${e.message}` });
    }
    finished = true;
    res.end();
  });
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/run') return handleRun(req, res);
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => {
    console.log(`双 Agent 控制台: http://localhost:${PORT}${MOCK ? ' (MOCK 预览)' : ''}`);
  });
