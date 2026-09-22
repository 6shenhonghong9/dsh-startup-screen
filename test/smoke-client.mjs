/* ============================================================================
 * 浏览器半侧冒烟测试 —— 不装进 DSH，直接按 ModuleLoader 的加载方式把
 * lib/client.js 跑起来，并用一套极小的 React stub 真渲染一遍设置面板，
 * 验证：bundle 协议 / 注册 id / slots.inject 参数 / 读配置 / 改身份名称 /
 *       保存 POST 体 / 恢复默认 / 立即预览。
 * 用法：node smoke-client.mjs
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

/* ── 极小的 React stub：够跑函数组件 + useState/useEffect ────────────────── */
const hooks = []
let hookIndex = 0
const ranEffects = new Set()
const React = {
  createElement(type, props, ...children) {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type, props: Object.assign({}, props || {}, { children: kids }) }
  },
  useState(init) {
    const i = hookIndex++
    if (hooks[i] === undefined) hooks[i] = typeof init === 'function' ? init() : init
    return [hooks[i], (next) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next }]
  },
  useEffect(fn) {
    const i = hookIndex++
    if (!ranEffects.has(i)) { ranEffects.add(i); fn() }
  },
  useStateReset() {},
}
function resetHooks() { hookIndex = 0 }

/* ── window / document stub ──────────────────────────────────────────────── */
const styleTags = []
const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({ tag, dataset: {}, set textContent(v) { this._t = v }, get textContent() { return this._t } }),
  head: { appendChild: (el) => styleTags.push(el) },
}

let loaded = null
const windowStub = {
  __ModuleLoader__: { load: (entry) => { loaded = entry } },
  addEventListener() {},
  location: { reload() { windowStub.__reloaded = true } },
}

/* ── fetch stub ──────────────────────────────────────────────────────────── */
const CFG = {
  enabled: true, mode: 'session', theme: 'light', speed: 1,
  requireInteraction: true, allowSkip: true, sound: true, soundVolume: 0.5,
  voice: true, voiceLang: 'en', voiceName: '', voiceRate: 1, voicePitch: 1, voiceVolume: 0.9,
  identity: 'JOYCE MOORE', identityId: '0087', accessLevel: '3',
  brand1: 'DEEPSEEK', brand2: 'SYNTHESIZE INTELLIGENCE', brand3a: 'HARNESS', brand3b: 'OS',
  orgZh: '深度求索', orgEn: 'DEEPSEEK', orgSub: 'DEEPSEEK HARNESS',
  welcomeBox: 'DEEPSEEK HARNESS', footer: 'POWERED BY DEEPSEEK',
  accent: '#ff7500', glitchA: '#ff3b30', glitchB: '#2971b8',
}
const requests = []
const fetchStub = (url, init) => {
  requests.push({ url, init })
  const isPost = init && init.method === 'POST'
  const body = isPost ? JSON.parse(init.body) : null
  let config = CFG
  if (body && body.action === 'reset') config = Object.assign({}, CFG)
  else if (body && body.patch) config = Object.assign({}, CFG, body.patch)
  return Promise.resolve({
    json: () => Promise.resolve(isPost
      ? { ok: true, config, defaults: CFG }
      : { ok: true, config, defaults: CFG, file: 'C:\\\\Users\\\\x\\\\.dsh\\\\dsh-startup.json' }),
  })
}

/* ── 按 ModuleLoader 的方式加载 bundle ───────────────────────────────────── */
console.log('\n[1] bundle 协议（window.__ModuleLoader__.load）')
const CLIENT_BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(CLIENT_BUNDLE, 'utf8')
const sandbox = {
  window: windowStub, document: documentStub, fetch: fetchStub,
  console, Promise, Object, Array, JSON, String, Number, Math, Date, Error,
  setTimeout, clearTimeout, Symbol,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })
check('调用了 ModuleLoader.load', loaded !== null)
check('注册 id 等于 loader entry 名（否则会报 loaded without registering）', loaded && loaded.id === 'dsh-startup-screen', loaded && loaded.id)
check('提供了 factory', loaded && typeof loaded.factory === 'function')

console.log('\n[2] factory 导出形状')
const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}
const mod = loaded.factory(requireStub)
check('exports.inject = ["slots"]', Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === 'slots', JSON.stringify(mod.inject))
check('exports.apply 是函数', typeof mod.apply === 'function')
check('注入了插件样式 <style data-plugin-css>', styleTags.length === 1 && styleTags[0].dataset.pluginCss === 'dsh-startup-screen/main.css', styleTags.length + ' 个')

console.log('\n[3] ctx.slots 注册 settings.section')
let registration = null
const ctx = {
  slots: {
    inject(name, fn) { check('slots.inject 的槽位名 = settings.section', name === 'settings.section', name); return fn() },
    register(options, render) { registration = { options, render }; return { dispose() {} } },
  },
}
mod.apply(ctx)
check('注册了 settings.section', registration !== null)
check('options.name 正确', registration && registration.options.name === 'settings.section', registration && registration.options.name)
check('options.id = startup-screen', registration && registration.options.id === 'startup-screen', registration && registration.options.id)
check('options.label = 启动动画（字符串，由注册方本地化）', registration && registration.options.label === '启动动画', registration && registration.options.label)
check('options.order 是数字', registration && typeof registration.options.order === 'number', registration && registration.options.order)
check('render 是函数', registration && typeof registration.render === 'function')

/* ── 真渲染面板 ──────────────────────────────────────────────────────────── */
function walk(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node !== 'object') return out          /* 文本节点本身不收集 */
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out }
  if (node.type) {
    /* 函数组件要展开（Field / Check / TextInput… 都不用 hooks，直接调用即可） */
    if (typeof node.type === 'function') return walk(node.type(node.props || {}), out)
    out.push(node)
    walk(node.props && node.props.children, out)
  }
  return out
}
function find(node, pred) { return walk(node).find(pred) }
const flush = () => new Promise((r) => setTimeout(r, 0))
/* render 返回的是 h(Panel, {}) 这个元素，要真正调用 Panel 才拿得到树 */
function renderPanel() {
  const el = registration.render({ close() {} })
  resetHooks()
  return el.type(el.props)
}

console.log('\n[4] 面板渲染 + 读取配置')
let tree = renderPanel()
check('首屏显示"读取配置中…"', JSON.stringify(tree).includes('读取配置中'), JSON.stringify(tree).slice(0, 80))
await flush(); await flush()
tree = renderPanel()
check('GET /dsh-startup/config 被调用', requests.some((r) => r.url === '/dsh-startup/config' && (!r.init || !r.init.method)), requests.map((r) => (r.init && r.init.method) || 'GET').join(','))
const texts = walk(tree).filter((n) => typeof n.props.children === 'string').map((n) => n.props.children)
check('渲染出「身份名称」字段', texts.includes('身份名称'), texts.slice(0, 12).join('/'))
check('渲染出「身份编号」字段', texts.includes('身份编号'))
check('渲染出「权限等级」字段', texts.includes('权限等级'))
const idInput = find(tree, (n) => n.type === 'input' && n.props.type === 'text' && n.props.value === 'JOYCE MOORE')
check('身份名称输入框回填了当前配置', !!idInput, idInput && idInput.props.value)
check('渲染出「启动动画」开关', texts.includes('启用启动动画'))
check('渲染出「女声播报」开关', texts.includes('女声播报（念每一行的英文）'))
check('渲染出「播报语言」字段', texts.includes('播报语言'))
check('渲染出「界面音效」开关', texts.includes('界面音效'))
check('渲染出音色选择（无 speechSynthesis 时给出提示）', texts.includes('音色'))
check('渲染出语速/音调/音量', texts.includes('语速') && texts.includes('音调') && texts.includes('音量'))
check('渲染出「立即预览」按钮', !!find(tree, (n) => n.type === 'button' && n.props.children === '立即预览'))
check('渲染出「恢复默认」按钮', !!find(tree, (n) => n.type === 'button' && n.props.children === '恢复默认'))

console.log('\n[5] 改身份名称 → 保存')
idInput.props.onChange({ target: { value: '琉璃' } })
tree = renderPanel()
const idInput2 = find(tree, (n) => n.type === 'input' && n.props.type === 'text')
check('改名后输入框值为「琉璃」', idInput2.props.value === '琉璃', idInput2.props.value)
const saveBtn = find(tree, (n) => n.type === 'button' && n.props.children === '保存')
check('找到保存按钮', !!saveBtn)
saveBtn.props.onClick()
await flush(); await flush(); await flush()
const post = requests.filter((r) => r.init && r.init.method === 'POST').pop()
check('POST 到 /dsh-startup/config', post && post.url === '/dsh-startup/config', post && post.url)
check('POST 体是 {patch:{identity:"琉璃",...}}', post && JSON.parse(post.init.body).patch.identity === '琉璃', post && post.init.body.slice(0, 90))
check('Content-Type 是 application/json', post && post.init.headers['Content-Type'] === 'application/json')
tree = renderPanel()
check('保存后提示已保存', JSON.stringify(tree).includes('已保存'), '')

console.log('\n[6] 恢复默认 / 立即预览')
const resetBtn = find(tree, (n) => n.type === 'button' && n.props.children === '恢复默认')
resetBtn.props.onClick()
await flush(); await flush()
const resetPost = requests.filter((r) => r.init && r.init.method === 'POST').pop()
check('恢复默认 POST {action:"reset"}', resetPost && JSON.parse(resetPost.init.body).action === 'reset', resetPost && resetPost.init.body)

windowStub.__DSH_STARTUP_API__ = { replay() { windowStub.__replayed = true } }
tree = renderPanel()
const previewBtn = find(tree, (n) => n.type === 'button' && n.props.children === '立即预览')
previewBtn.props.onClick()
check('立即预览调用 __DSH_STARTUP_API__.replay()', windowStub.__replayed === true)
delete windowStub.__DSH_STARTUP_API__
previewBtn.props.onClick()
check('没有 API 时回退到 location.reload()', windowStub.__reloaded === true)

console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
