/* ============================================================================
 * 桌面端自举冒烟测试
 * ----------------------------------------------------------------------------
 * 验的是 lib/client.js 里那条兜底路径：**Host 的 index 注入不生效时**（桌面端
 * 若走 file:// + IPC 下发前端），浏览器半侧要能自己把启动界面立起来。
 *
 * 不装 DSH，也不开浏览器：用一套最小的 document / window stub 按
 * ModuleLoader 的加载方式跑 lib/client.js，然后断言：
 *   [1] Host 没注入 → 自举：建根节点 / 锁滚动 / 拉 splash.css / 挂 splash.js
 *   [2] Host 注入过（BOOT 标记）→ 一律不动手
 *   [3] 配置已就位 / enabled=false / session·daily 已播过 → 不播
 *   [4] 未播过 → 播，并且回填与 Host 侧同款的持久化标记
 *   [5] 资源加载失败 → 把页面还回去（移除根节点、解开滚动锁）
 *
 * 用法：node smoke-desktop.mjs
 * ========================================================================== */
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + extra : '')) }
}

const CLIENT_BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const CODE = fs.readFileSync(CLIENT_BUNDLE, 'utf8')

/* ── 最小 DOM ────────────────────────────────────────────────────────────── */
class Elem {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attrs = {}
    this.dataset = {}
    this.style = {}
    this.textContent = ''
    this._listeners = {}
    this._className = ''
    this.classList = {
      _set: new Set(),
      add: (c) => { this.classList._set.add(c); this._className = syncClass(this) },
      remove: (c) => { this.classList._set.delete(c); this._className = syncClass(this) },
      contains: (c) => this.classList._set.has(c),
      toggle: (c, on) => (on ? this.classList.add(c) : this.classList.remove(c)),
    }
  }
  set className(v) {
    this._className = String(v)
    this.classList._set = new Set(this._className.split(/\s+/).filter(Boolean))
  }
  get className() { return this._className }
  appendChild(child) {
    if (child && child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }
  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at !== -1) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v)
    /* getElementById 只认 id 属性，这里单独兜一下 */
    if (k === 'id') this.id = String(v)
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn) }
  /* 测试里手动触发 load / error */
  emit(type) { for (const fn of this._listeners[type] || []) fn({ type }) }
}
function syncClass(el) { return [...el.classList._set].join(' ') }

/* 遍历器要同时认两种「孩子」：DOM 节点的 .children 和 React 元素的 .props.children */
function walk(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out }
  out.push(node)
  for (const c of node.children || []) walk(c, out)
  for (const c of (node.props && node.props.children) || []) walk(c, out)
  return out
}

function makeStorage(seed) {
  const map = new Map(Object.entries(seed || {}))
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
}

/** 起一个全新的沙箱，按 ModuleLoader 的方式跑一遍 client bundle。 */
function boot(opts) {
  const o = opts || {}
  const head = new Elem('head')
  const body = new Elem('body')
  const html = new Elem('html')
  const all = []
  const warnings = []
  const requested = []
  const timers = []

  const documentStub = {
    head, body, documentElement: html,
    querySelector: () => null,
    createElement: (tag) => { const e = new Elem(tag); all.push(e); return e },
    getElementById: (id) => walk(html).concat(walk(head), walk(body))
      .find((e) => e.attrs.id === id || (e.id && e.id === id)) || null,
  }
  /* 根节点按 id 挂载：createElement 之后设 .id，这里补一个查找口径 */
  const realGetById = documentStub.getElementById
  documentStub.getElementById = (id) => realGetById(id) || walk(head).concat(walk(body)).find((e) => e.id === id) || null

  const win = {
    __ModuleLoader__: { load: (entry) => { win.__loaded = entry } },
    location: { href: 'http://127.0.0.1:3080/', reload() { win.__reloaded = true } },
    addEventListener() {},
    sessionStorage: makeStorage(o.session),
    localStorage: makeStorage(o.local),
    speechSynthesis: undefined,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: () => {},
  }
  win.window = win
  if (o.given) for (const [k, v] of Object.entries(o.given)) win[k] = v

  const fetchStub = (url, init) => {
    requested.push({ url, init })
    if (o.fetchFails) return Promise.reject(new Error('boom'))
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(o.apiResponse !== undefined
        ? o.apiResponse
        : { ok: true, config: o.config || { enabled: true, mode: 'session', speed: 1 }, defaults: {}, file: 'X' }),
      text: () => Promise.resolve(''),
    })
  }

  const sandbox = {
    window: win, document: documentStub, fetch: fetchStub,
    console: { log() {}, warn: (...a) => warnings.push(a.map(String).join(' ')), error() {} },
    Promise, Object, Array, JSON, String, Number, Math, Date, Error, Symbol, isFinite, RegExp,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(CODE, sandbox, { filename: 'client.js' })

  const React = {
    createElement(type, props, ...children) {
      const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: Object.assign({}, props || {}, { children: kids }) }
    },
    useState: (v) => (typeof v === 'function' ? [v(), () => {}] : [v, () => {}]),
    useEffect: () => {},
  }
  const mod = win.__loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  const registrations = []
  const ctx = {
    slots: {
      inject: (slot, fn) => fn(),
      register: (options, render) => { registrations.push({ options, render }); return { dispose() {} } },
    },
  }
  let applied = false
  function doApply() {
    if (applied) throw new Error('apply 只会被调一次')
    applied = true
    mod.apply(ctx)
  }

  return { win, head, body, html, requested, warnings, timers, registrations, document: documentStub, apply: doApply }
}

const tags = (sandbox, pred) => walk(sandbox.head).concat(walk(sandbox.body)).filter(pred)
const rootOf = (sandbox) => sandbox.document.getElementById('dsh-startup-root')
const flush = () => new Promise((r) => process.nextTick(r))
async function settle(n = 8) { for (let i = 0; i < n; i++) await flush() }

/** 面板 render 返回的是 h(Panel, {}) 这个元素，要真正调用 Panel 才拿得到树。 */
function panelTree(sandbox) {
  const el = sandbox.registrations[0].render({})
  return el && typeof el.type === 'function' ? el.type(el.props || {}) : el
}
/** 把设置面板真渲染一次，收集其中的字符串（用来验顶部那行版本号）。 */
function panelTexts(sandbox) {
  return walk(panelTree(sandbox)).filter((n) => typeof n.props.children === 'string').map((n) => n.props.children)
}
/** 找出版本号节点（className 恒为 __ss_version）。 */
function versionText(sandbox) {
  const node = walk(panelTree(sandbox)).find((n) => n.props && n.props.className === '__ss_version')
  return node ? String(node.props.children) : ''
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('\n[1] Host 没注入（桌面端 file:// + IPC 形态）→ 自举')
{
  const s = boot()
  check('仅加载 bundle 时不抢跑（apply 之前没有任何标记）', s.win.__DSH_STARTUP_BOOT__ === undefined, String(s.win.__DSH_STARTUP_BOOT__))
  s.apply()
  check('apply() 里先自举，settings.section 照样注册', s.registrations.length === 1)
  await settle()
  check('打了 __DSH_STARTUP_BOOT__ = client', s.win.__DSH_STARTUP_BOOT__ === 'client', String(s.win.__DSH_STARTUP_BOOT__))
  check('读了 Host 配置接口 /dsh-startup/config', s.requested.some((r) => r.url === '/dsh-startup/config'), s.requested.map((r) => r.url).join(','))
  const root = rootOf(s)
  check('建了 #dsh-startup-root', !!root)
  check('根节点带 dsu-boot（首屏黑幕态）', root && root.className.indexOf('dsu-boot') !== -1, root && root.className)
  check('锁住了 <html> 滚动（dsu-lock）', s.html.classList.contains('dsu-lock'))
  const link = tags(s, (e) => e.tagName === 'LINK' && e.href === '/dsh-startup/splash.css')[0]
  check('挂了 splash.css 样式表', !!link, link && link.href)
  const script = tags(s, (e) => e.tagName === 'SCRIPT' && String(e.src || '').indexOf('/dsh-startup/splash.js') === 0)[0]
  check('挂了 splash.js 运行时', !!script, script && script.src)
  check('splash.js 带时间戳绕缓存', script && /splash\.js\?t=\d+$/.test(String(script.src)), script && script.src)
  check('配置先落 window（splash.js 直接读它）', s.win.__DSH_STARTUP__ && s.win.__DSH_STARTUP__.identity === undefined && s.win.__DSH_STARTUP__.enabled === true, JSON.stringify(s.win.__DSH_STARTUP__))
  check('session 模式回填了同款已播标记', s.win.sessionStorage.getItem('dsh-startup-screen:shown') === '1')
  check('挂了 9 秒自愈定时器', s.timers.some((t) => t.ms === 9000), s.timers.map((t) => t.ms).join(','))
}

console.log('\n[2] Host 已经注入过 → 一律不动手')
{
  const s = boot({ given: { __DSH_STARTUP_BOOT__: 'index', __DSH_STARTUP__: { enabled: true, mode: 'session' } } }); s.apply()
  await settle()
  check('没碰 BOOT 标记', s.win.__DSH_STARTUP_BOOT__ === 'index', String(s.win.__DSH_STARTUP_BOOT__))
  check('没有建根节点', rootOf(s) === null)
  check('没有请求配置接口', !s.requested.some((r) => r.url === '/dsh-startup/config'), s.requested.map((r) => r.url).join(','))
  check('没有挂 splash.js', tags(s, (e) => e.tagName === 'SCRIPT').length === 0)
}
{
  /* 只有配置、没有 BOOT 标记（老版本 Host 注入）：同样当作已接管 */
  const s = boot({ given: { __DSH_STARTUP__: { enabled: true, mode: 'session' } } }); s.apply()
  await settle()
  check('只有 __DSH_STARTUP__ 时也不重复自举', rootOf(s) === null && s.win.__DSH_STARTUP_BOOT__ === undefined)
}
{
  const s = boot({ given: { __DSH_STARTUP_SKIP__: true, __DSH_STARTUP_BOOT__: 'index' } }); s.apply()
  await settle()
  check('Host 判定跳过时不抢播', rootOf(s) === null)
}

console.log('\n[3] 不播的几种情况')
{
  const s = boot({ config: { enabled: false, mode: 'session' } }); s.apply()
  await settle()
  check('enabled=false → 不建根节点', rootOf(s) === null)
  check('enabled=false → 不写已播标记', s.win.sessionStorage.getItem('dsh-startup-screen:shown') === null)
}
{
  const s = boot({
    config: { enabled: true, mode: 'session' },
    session: { 'dsh-startup-screen:shown': '1' },
  }); s.apply()
  await settle()
  check('session 模式本会话已播过 → 不重播', rootOf(s) === null)
}
{
  const today = new Date().toISOString().slice(0, 10)
  const s = boot({
    config: { enabled: true, mode: 'daily' },
    local: { 'dsh-startup-screen:day': today },
  }); s.apply()
  await settle()
  check('daily 模式今天已播过 → 不重播', rootOf(s) === null)
}
{
  const s = boot({ config: { enabled: true, mode: 'always' }, session: { 'dsh-startup-screen:shown': '1' } }); s.apply()
  await settle()
  check('always 模式无视已播标记 → 照播', !!rootOf(s))
  check('always 模式不写 session 标记', s.win.sessionStorage.getItem('dsh-startup-screen:shown') === '1', '（应保持原值 1）')
}
{
  const s = boot({ config: { enabled: true, mode: 'daily' } }); s.apply()
  await settle()
  const today = new Date().toISOString().slice(0, 10)
  check('daily 模式首次播放 → 记下今天的日期', s.win.localStorage.getItem('dsh-startup-screen:day') === today, s.win.localStorage.getItem('dsh-startup-screen:day'))
  check('daily 模式不写 session 标记', s.win.sessionStorage.getItem('dsh-startup-screen:shown') === null)
}

console.log('\n[4] 自举失败 → 把页面还回去')
{
  const s = boot(); s.apply()
  await settle()
  const root = rootOf(s)
  const script = tags(s, (e) => e.tagName === 'SCRIPT')[0]
  check('[前置] 根节点在', !!root)
  script.emit('error')
  await settle()
  check('脚本载入失败 → 移除根节点', rootOf(s) === null)
  check('脚本载入失败 → 解开滚动锁', !s.html.classList.contains('dsu-lock'), s.html.className)
  check('脚本载入失败 → 亮 FAILED 标记', s.win.__DSH_STARTUP_FAILED__ === true)
  check('脚本载入失败 → 打了警告日志', s.warnings.some((w) => w.indexOf('自举失败') !== -1), s.warnings.join(' | '))
}
{
  const s = boot(); s.apply()
  await settle()
  const root = rootOf(s)
  root.className = 'dsu-root dsu-boot'
  const selfHeal = s.timers.filter((t) => t.ms === 9000).pop()
  check('[前置] 拿到 9 秒自愈回调', !!selfHeal)
  selfHeal.fn()
  check('自愈触发 → 移除黑幕根节点', rootOf(s) === null)
  check('自愈触发 → 解开滚动锁', !s.html.classList.contains('dsu-lock'))
}
{
  const s = boot({ fetchFails: true }); s.apply()
  await settle()
  check('配置接口不可达 → 按默认（启用/session）照播，不留白', !!rootOf(s))
  check('配置接口不可达 → 不抛异常（apply 已跑完）', s.registrations.length === 1)
}
{
  const s = boot({ apiResponse: { ok: false, error: 'nope' } }); s.apply()
  await settle()
  check('配置接口返回 ok:false → 走默认配置照播', !!rootOf(s))
}
{
  /* 唯一明确"不播"的信号是配置里 enabled=false，见 [3] */
  const s = boot({ fetchFails: true, session: { 'dsh-startup-screen:shown': '1' } }); s.apply()
  await settle()
  check('session 已播 + 配置接口不可达 → 宁可不播（不重复打扰）', rootOf(s) === null)
}

console.log('\n[5] 自举与设置面板互不干扰')
{
  const s = boot(); s.apply()
  await settle()
  check('settings.section 注册成功且 id/order 正确',
    s.registrations[0].options.name === 'settings.section' && s.registrations[0].options.id === 'startup-screen',
    JSON.stringify(s.registrations[0].options))
  check('自举后仍暴露设置面板 render', typeof s.registrations[0].render === 'function')
}

console.log('\n[6] 设置面板顶部的版本号（桌面端 / 旧 Host 的兜底链）')
{
  const pkgVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  /* Host 没注入版本、配置接口也没回版本 —— 面板显示本地兜底常量 */
  const s = boot(); s.apply()
  await settle()
  const injected = s.win.__DSH_STARTUP_VERSION__
  const text = versionText(s)
  check('没有版本来源时仍显示版本号（不出现 undefined）', /^版本 v\d+\.\d+\.\d+/.test(text), text)
  check('兜底常量与 package.json 的版本一致（防两处漂移）', text === '版本 v' + pkgVersion, text + ' vs ' + pkgVersion)
  check('顶部那行确实是版本号，不是原来那段说明', !panelTexts(s).some((t) => String(t).includes('启动界面：')), '')
  check('host 没注入版本时 window.__DSH_STARTUP_VERSION__ 为空', !injected, String(injected))
}

console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
