/* ============================================================================
 * Host 半侧冒烟测试 —— 不装进 DSH，直接用假 ctx 把 apply() 跑一遍。
 * 覆盖：路由注册 / 信任栅栏 / 配置读写落盘 / index.html 注入结果。
 * 用法：node smoke-host.mjs
 * ========================================================================== */
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 找一份真实的 DSH dist/index.html 来做注入测试；找不到就用等价的最小样本。
 *  跨平台：Windows 的 npx 缓存在 %LOCALAPPDATA%，POSIX 在 ~/.npm 或 ~/.cache。 */
function findRealIndex() {
  const candidates = []
  if (process.env.DSH_FRONTEND_INDEX) candidates.push(process.env.DSH_FRONTEND_INDEX)
  const caches = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx'),
    path.join(os.homedir(), '.cache', 'npm', '_npx'),
  ].filter(Boolean)
  for (const npx of caches) {
    try {
      for (const d of fs.readdirSync(npx)) {
        candidates.push(path.join(npx, d, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'))
      }
    } catch { /* 这个缓存目录不存在，换下一个 */ }
  }
  for (const c of candidates) if (fs.existsSync(c)) return { path: c, html: fs.readFileSync(c, 'utf8') }
  /* 样本严格照 DSH dist/index.html 的形状写（属性都带引号），
     这样没装 DSH 的机器上跑到的断言和真机完全一致 */
  return { path: '(内置样本，形状等同 DSH dist/index.html)', html: [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>DeepSeek Harness</title>',
    '    <script type="module" crossorigin src="./assets/index-XXX.js"></script>',
    '    <link rel="stylesheet" crossorigin href="./assets/vendor-XXX.css">',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n') }
}
const REAL_INDEX = findRealIndex()
const SMOKE_HOME = path.join(os.tmpdir(), 'dsh-startup-smoke-' + Date.now())
fs.mkdirSync(SMOKE_HOME, { recursive: true })
process.env.DSH_HOME = SMOKE_HOME

const ROUTES = new Map()
const TAPS = []
let effects = 0
let rejectNext = undefined

const ctx = {
  webServer: {
    register(route) {
      if (ROUTES.has(route.kind + ' ' + route.path)) throw new Error('duplicate route ' + route.path)
      ROUTES.set(route.kind + ' ' + route.path, route)
      return () => ROUTES.delete(route.kind + ' ' + route.path)
    },
    tapIndex(fn) { TAPS.push(fn); return () => TAPS.splice(TAPS.indexOf(fn), 1) },
  },
  get(name) {
    if (name !== 'connection') return undefined
    return {
      // 官方 dsh-host-open-in-app 同款栅栏：返回 undefined = 放行
      requestRejection() { return rejectNext },
    }
  },
  effect(fn) { effects++; const d = fn(); return () => { if (typeof d === 'function') d() } },
}

class FakeReq extends EventEmitter {
  constructor(method, body, url) {
    super()
    this.method = method
    this.headers = { host: '127.0.0.1:3080' }
    this.url = url || '/'
    process.nextTick(() => {
      if (body !== undefined) this.emit('data', Buffer.from(body))
      this.emit('end')
    })
  }
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this },
    end(buf) { this.body = buf === undefined ? '' : Buffer.from(buf).toString('utf8') },
  }
}

async function call(kindPath, method = 'GET', body, url) {
  const route = ROUTES.get(kindPath)
  if (!route) throw new Error('route missing: ' + kindPath)
  const res = fakeRes()
  await route.handler(new FakeReq(method, body, url), res)
  return res
}

let pass = 0
let fail = 0
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')) }
}

console.log('\n[1] 模块导出形状（对齐 cordis-plugin-loader 的 unwrapExports）')
const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'index.js')).href)
check('有具名 name', typeof mod.name === 'string', mod.name)
check('name 与 cordis.patch.yml 的 id 一致', mod.name === 'dsh-startup-screen', mod.name)
check('有具名 inject', Array.isArray(mod.inject), JSON.stringify(mod.inject))
check('inject 含 webServer + connection', mod.inject.includes('webServer') && mod.inject.includes('connection'))
check('有具名 apply', typeof mod.apply === 'function')
check('没有 default 导出（避免 unwrapExports 只认 default）', mod.default === undefined, String(mod.default))
check('没有 Config 导出（普通对象不是 schemastery schema）', mod.Config === undefined, String(mod.Config))

console.log('\n[2] apply(ctx)：路由与注入')
mod.apply(ctx)
check('注册了 4 条路由', ROUTES.size === 4, [...ROUTES.keys()].join(' | '))
check('注册了 1 个 tapIndex', TAPS.length === 1)
check('用了 ctx.effect 管理生命周期', effects === 1, String(effects))

console.log('\n[3] 静态路由')
let r = await call('exact /dsh-startup/splash.css')
check('splash.css 200 + 正确 MIME', r.statusCode === 200 && /text\/css/.test(r.headers['Content-Type']), r.headers['Content-Type'])
check('splash.css 非空', r.body.length > 10000, r.body.length + ' bytes')
r = await call('exact /dsh-startup/splash.js')
check('splash.js 200 + 正确 MIME', r.statusCode === 200 && /javascript/.test(r.headers['Content-Type']), r.headers['Content-Type'])
check('splash.js 非空', r.body.length > 20000, r.body.length + ' bytes')

console.log('\n[3b] 音频素材路由')
r = await call('prefix /dsh-startup/asset')
check('请求 /asset 无文件名 -> 404', r.statusCode === 404, String(r.statusCode))
r = await call('prefix /dsh-startup/asset', 'GET', undefined, '/dsh-startup/asset/sfx-tick.mp3')
check('sfx-tick.mp3 -> 200 + audio/mpeg', r.statusCode === 200 && r.headers['Content-Type'] === 'audio/mpeg', r.headers['Content-Type'])
check('sfx-tick.mp3 有内容', r.body.length > 500, r.body.length + ' bytes')
r = await call('prefix /dsh-startup/asset', 'GET', undefined, '/dsh-startup/asset/../../package.json')
check('目录穿越被拒 -> 404', r.statusCode === 404, String(r.statusCode))
r = await call('prefix /dsh-startup/asset', 'GET', undefined, '/dsh-startup/asset/nope.mp3')
check('不存在的素材 -> 404', r.statusCode === 404, String(r.statusCode))
for (const f of ['line-1', 'line-2', 'line-3', 'line-4', 'line-5']) {
  const rr = await call('prefix /dsh-startup/asset', 'GET', undefined, '/dsh-startup/asset/' + f + '.mp3')
  check('真声素材 ' + f + '.mp3 -> 200', rr.statusCode === 200 && rr.body.length > 5000, rr.statusCode + ' ' + rr.body.length)
}

console.log('\n[4] 配置读写落盘')
r = await call('exact /dsh-startup/config')
let cfg = JSON.parse(r.body)
check('GET config ok', cfg.ok === true)
check('默认身份名称 = JOYCE MOORE', cfg.config.identity === 'JOYCE MOORE', cfg.config.identity)
check('默认身份编号 = 0087', cfg.config.identityId === '0087', cfg.config.identityId)
check('返回了配置文件路径', typeof cfg.file === 'string' && cfg.file.startsWith(SMOKE_HOME), cfg.file)

r = await call('exact /dsh-startup/config', 'POST', JSON.stringify({ patch: { identity: '琉璃', speed: 99, enabled: 'true' } }))
cfg = JSON.parse(r.body)
check('POST config ok', cfg.ok === true)
check('身份名称写入成功（中文）', cfg.config.identity === '琉璃', cfg.config.identity)
check('speed 被夹到上限 3', cfg.config.speed === 3, String(cfg.config.speed))
check('enabled 字符串 "true" 被转成 boolean true', cfg.config.enabled === true, String(cfg.config.enabled))
check('配置已落盘', fs.existsSync(path.join(SMOKE_HOME, 'dsh-startup.json')))

r = await call('exact /dsh-startup/config', 'POST', JSON.stringify({ patch: { identityId: '' } }))
check('身份编号留空 + 纯中文名 → 兜底 OPERATOR', JSON.parse(r.body).config.identityId === 'OPERATOR', JSON.parse(r.body).config.identityId)
r = await call('exact /dsh-startup/config', 'POST', JSON.stringify({ patch: { identity: 'Ada Lovelace', identityId: '' } }))
check('身份编号留空 + 英文名 → 自动派生 ADALOVELACE', JSON.parse(r.body).config.identityId === 'ADALOVELACE', JSON.parse(r.body).config.identityId)
r = await call('exact /dsh-startup/config', 'POST', JSON.stringify({ patch: { speed: 0.01, theme: 'neon', accent: 'javascript:alert(1)' } }))
cfg = JSON.parse(r.body)
check('speed 低于下限被夹到 0.35', cfg.config.speed === 0.35, String(cfg.config.speed))
check('非法 theme 回落到 light', cfg.config.theme === 'light', cfg.config.theme)
check('非法颜色回落到默认橙', cfg.config.accent === '#ff7500', cfg.config.accent)

r = await call('exact /dsh-startup/config', 'POST', JSON.stringify({ action: 'reset' }))
check('reset 恢复默认', JSON.parse(r.body).config.identity === 'JOYCE MOORE')

r = await call('exact /dsh-startup/config', 'POST', '{ not json')
check('非法 JSON 返回 400', r.statusCode === 400, String(r.statusCode))
r = await call('exact /dsh-startup/config', 'DELETE')
check('不支持的方法返回 405', r.statusCode === 405, String(r.statusCode))

console.log('\n[5] 信任栅栏（DNS 重绑定 / 未认证请求）')
rejectNext = 403
r = await call('exact /dsh-startup/config')
check('connection 拒绝时返回 403 且不吐配置', r.statusCode === 403 && r.body === '', r.statusCode + ' body=' + JSON.stringify(r.body.slice(0, 40)))
rejectNext = undefined

/** 从注入结果里精确抠出内联 JSON 载荷（window.__DSH_STARTUP__= ... ;BOOTSTRAP） */
function inlinePayload(html) {
  const a = html.indexOf('window.__DSH_STARTUP__=')
  const b = html.indexOf(';(function(){try{', a)
  return a === -1 || b === -1 ? '' : html.slice(a + 'window.__DSH_STARTUP__='.length, b)
}

console.log('\n[6] index.html 注入（源: ' + REAL_INDEX.path + '）')
const before = REAL_INDEX.html
const after = TAPS[0](before)
check('注入了 splash.css <link>', after.includes('<link rel="stylesheet" href="/dsh-startup/splash.css">'))
check('注入了首屏兜底 <style>', after.includes('id="dsh-startup-critical"') && after.includes('dsu-boot'))
check('注入了挂载点 div', after.includes('<div id="dsh-startup-root" class="dsu-root dsu-boot">'))
check('注入了 window.__DSH_STARTUP__ 配置', /^\{"enabled":/.test(inlinePayload(after)), inlinePayload(after).slice(0, 60))
check('内联载荷是合法 JSON', (() => { try { JSON.parse(inlinePayload(after)); return true } catch { return false } })())
check('注入了 defer 运行时脚本', after.includes('<script defer src="/dsh-startup/splash.js"></script>'))
check('配置落在 </head> 之前', after.indexOf('dsh-startup-critical') < after.indexOf('</head>'))
check('挂载点紧跟 <body>', /<body>\s*<div id="dsh-startup-root"/.test(after))
check('幂等：二次调用不重复注入', TAPS[0](after) === after)
check('原 <div id="root"></div> 仍在（应用照常挂载）', after.includes('<div id="root"></div>'))
check('内联载荷里没有裸的 < （防 </script> 提前闭合）', !inlinePayload(after).includes('<'))

console.log('\n[7] XSS 边界：身份名称里的尖括号不会逃出内联脚本')
await call('exact /dsh-startup/config', 'POST', JSON.stringify({ patch: { identity: '</script><img src=x onerror=alert(1)>' } }))
const payload = inlinePayload(TAPS[0](before))
check('尖括号被转义成 \\u003c', payload.includes('\\u003c'), payload.slice(0, 120))
check('载荷里没有 </script>', !payload.includes('</script>'))
check('转义后仍是合法 JSON 且值可还原', (() => {
  try { return JSON.parse(payload).identity === '</script><img src=x onerror=alert(1)>' } catch { return false }
})())

fs.rmSync(SMOKE_HOME, { recursive: true, force: true })
console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
