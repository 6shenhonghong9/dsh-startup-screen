/* ============================================================================
 * 启动动画初始化冒烟测试 —— 用最小 DOM 桩把 splash.js 完整跑一遍
 *
 * 为什么需要它：黑幕兜底是"贴在第一屏上的"，一旦 splash.js 初始化抛异常，
 * dsu-boot 就永远摘不掉 → 用户看到永久黑屏。这个测试专门守住那条线：
 *   1) 初始化不许抛异常
 *   2) 跑完必须摘掉 dsu-boot（否则就是黑屏）
 *   3) 暴露 __DSH_STARTUP_API__
 *   4) JS 里用到的每个选择器，都必须在生成出来的 markup 里真实存在
 *      —— 这条能抓到"接了个不存在的元素"这类手误
 *   5) 没有 speechSynthesis 的环境（Node / 老浏览器）也必须能跑
 *
 * 用法：node test/smoke-splash.mjs
 * ========================================================================== */
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const BUNDLE = fileURLToPath(new URL('../lib/splash.js', import.meta.url))

let pass = 0
let fail = 0
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + extra : '')) }
}

/* ── 最小 DOM 桩 ─────────────────────────────────────────────────────────── */
function makeEl(tag) {
  const el = {
    tagName: tag,
    _cls: '',
    _text: '',
    _html: '',
    /* 记录型 style：chromeSync 会读写内联属性，这里要能断言"设过 / 还原了" */
    style: (() => {
      const map = new Map()
      return {
        _map: map,
        setProperty(k, v) { map.set(String(k), String(v)) },
        removeProperty(k) { map.delete(String(k)) },
        getPropertyValue(k) { return map.get(String(k)) || '' },
        get backgroundColor() { return map.get('background-color') || '' },
        set backgroundColor(v) { map.set('background-color', String(v)) },
      }
    })(),
    dataset: {},
    children: [],
    hidden: false,
    offsetWidth: 1,
    parentNode: null,
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c },
    insertBefore(c) { this.children.unshift(c); if (c) c.parentNode = this; return c },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c },
    setAttribute() {},
    getAttribute() { return null },
    hasAttribute() { return false },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    animate() { return { cancel() {}, finish() {} } },
    getTotalLength() { return 120 },
    querySelector(sel) { return lookup(sel) },
    querySelectorAll() { return [] },
    focus() {},
    contains() { return false },
  }
  Object.defineProperty(el, 'className', {
    get() { return el._cls },
    set(v) { el._cls = v == null ? '' : String(v) },
  })
  Object.defineProperty(el, 'textContent', {
    get() { return el._text },
    set(v) { el._text = v == null ? '' : String(v) },
  })
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html },
    set(v) { el._html = v == null ? '' : String(v); MARKUP = el._html },
  })
  el.classList = {
    add(...cs) { cs.forEach((c) => { if (!el._cls.split(' ').includes(c)) el._cls = (el._cls + ' ' + c).trim() }) },
    remove(...cs) { cs.forEach((c) => { el._cls = el._cls.split(' ').filter((x) => x && x !== c).join(' ') }) },
    toggle(c, on) {
      const has = el._cls.split(' ').includes(c)
      const want = on === undefined ? !has : !!on
      if (want && !has) el.classList.add(c)
      if (!want && has) el.classList.remove(c)
    },
    contains(c) { return el._cls.split(' ').includes(c) },
  }
  return el
}

/* markup 里出现过的 class 集合：选择器必须命中它，否则视为"接了个不存在的元素" */
let MARKUP = ''
const MISSED = new Set()
const lookupCache = new Map()
function lookup(sel) {
  if (!sel) return null
  const key = String(sel)
  if (lookupCache.has(key)) return lookupCache.get(key)
  const m = /\.([A-Za-z0-9_-]+)/.exec(key)
  const cls = m ? m[1] : null
  const found = cls !== null && MARKUP.includes(cls)
  if (!found) MISSED.add(key)
  const node = found ? makeEl('div') : null
  lookupCache.set(key, node)
  return node
}

/* ── window / document ───────────────────────────────────────────────────── */
const spoken = []
function makeSpeech() {
  return {
    /* 故意混入"老拼接合成"音色：David(男) / Zira(女) / Huihui(女)，
       正确的选择应该跳过它们，挑 Online (Natural) 那两个 */
    _voices: [
      { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US', localService: true },
      { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US', localService: true },
      { name: 'Microsoft Huihui Desktop - Chinese (Simplified)', lang: 'zh-CN', localService: true },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false },
      { name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', lang: 'zh-CN', localService: false },
    ],
    getVoices() { return this._voices },
    speak(u) { spoken.push(u) },
    cancelCalls: 0,
    cancel() { this.cancelCalls++; spoken.length = 0 },
    resume() {},
    pause() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

function run(withSpeech, cfgOverride, env) {
  MARKUP = ''
  MISSED.clear()
  lookupCache.clear()
  spoken.length = 0
  const E = env || {}

  const root = makeEl('div')
  root._cls = 'dsu-root dsu-boot'
  const head = makeEl('head')
  const body = makeEl('body')
  const htmlEl = makeEl('html')

  const documentStub = {
    readyState: 'complete',
    head, body,
    documentElement: htmlEl,
    getElementById: (id) => (id === 'dsh-startup-root' ? root : null),
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    querySelector: (sel) => (E.probe && /span/.test(String(sel)) ? E.probe : null),
    querySelectorAll: (sel) => (E.probe && /span/.test(String(sel)) ? [E.probe] : []),
    addEventListener() {},
    removeEventListener() {},
  }

  const timers = []
  const windowStub = {
    __DSH_STARTUP__: {
      enabled: true, mode: 'always', theme: 'light', speed: 1,
      requireInteraction: true, allowSkip: true,
      identity: 'JOYCE MOORE', identityId: '0087', accessLevel: '3',
      /* 只覆盖测试要变的；语速/音调/留白故意留空，好让断言直接校验 splash.js 出厂默认值 */
      voice: true, voiceLang: 'en', voiceName: '',
      sound: true, soundVolume: 0.5,
    },
    AudioContext: function () {
      return {
        state: 'running', currentTime: 0, sampleRate: 48000, destination: {},
        resume() {},
        createOscillator() {
          return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }
        },
        createGain() {
          return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
        },
        createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) } },
        createBufferSource() { return { buffer: null, connect() {}, start() {} } },
        createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} } },
      }
    },
    location: {
      host: '127.0.0.1:3080',
      href: (E.protocol || 'http:') + '//127.0.0.1:3080/',
      protocol: E.protocol || 'http:',
    },
    navigator: { userAgent: E.userAgent || 'Mozilla/5.0 (X11; Linux x86_64)' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    sessionStorage: { getItem: () => null, setItem() {} },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (fn) => { fn(); return 1 },
    cancelAnimationFrame() {},
    /* 小延时同步执行 —— voiceLead 是 240ms，不这样做 line() 永远开不了口；
       大延时（动画时间线）照旧入队，测试保持同步可控 */
    setTimeout: (fn, ms) => {
      if ((ms || 0) <= 400) { fn(); return -1 }
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    CustomEvent: function (t) { this.type = t },
  }
  if (withSpeech) {
    windowStub.speechSynthesis = makeSpeech()
    /* 浏览器里 window === globalThis，但沙箱里是两回事：
       splash.js 检查的是 window.SpeechSynthesisUtterance，所以两边都要挂 */
    windowStub.SpeechSynthesisUtterance = function (t) {
      this.text = t; this.rate = 1; this.pitch = 1; this.volume = 1
    }
  }
  windowStub.window = windowStub

  const sandbox = {
    window: windowStub,
    document: documentStub,
    console,
    /* chromeSync 用 getComputedStyle 判断探针是否已真的透明 */
    getComputedStyle: (el) => ({
      get backgroundColor() {
        const v = el && el.style ? el.style.getPropertyValue('background-color') : ''
        return v || (E.computedBg || 'rgb(27, 27, 28)')
      },
    }),
    MutationObserver: E.MutationObserver,
    Promise, Object, Array, JSON, String, Number, Math, Date, Error, RegExp, isFinite,
    setTimeout: windowStub.setTimeout,
    clearTimeout: windowStub.clearTimeout,
    setInterval: windowStub.setInterval,
    clearInterval: windowStub.clearInterval,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    SpeechSynthesisUtterance: withSpeech
      ? function (t) { this.text = t; this.rate = 1; this.pitch = 1; this.volume = 1 }
      : undefined,
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox

  /* 配置覆盖必须在跑脚本之前生效 —— splash.js 只在加载时读一次配置 */
  Object.assign(windowStub.__DSH_STARTUP__, cfgOverride || {})

  vm.createContext(sandbox)
  const src = fs.readFileSync(BUNDLE, 'utf8')
  let thrown = null
  try {
    vm.runInContext(src, sandbox, { filename: 'splash.js' })
  } catch (e) {
    thrown = e
  }
  return { windowStub, root, head, timers, thrown, markup: MARKUP, sandbox, spoken }
}

/* ── 开跑 ───────────────────────────────────────────────────────────────── */
console.log('\n[1] 有 speechSynthesis 的环境（Chrome / Edge）')
let r = run(true)
check('初始化不抛异常', r.thrown === null, r.thrown && (r.thrown.message + '\n       ' + String(r.thrown.stack).split('\n')[1]))
check('摘掉了黑幕 dsu-boot（没摘掉 = 永久黑屏）', !r.root.classList.contains('dsu-boot'), '当前 class = ' + r.root._cls)
check('暴露了 __DSH_STARTUP_API__', !!(r.windowStub.__DSH_STARTUP_API__ && r.windowStub.__DSH_STARTUP_API__.replay))
check('API 上有 replay / skip / finish', ['replay', 'skip', 'finish'].every((k) => typeof (r.windowStub.__DSH_STARTUP_API__ || {})[k] === 'function'))
check('没有 FAILED 兜底标记', r.windowStub.__DSH_STARTUP_FAILED__ !== true)

console.log('\n[2] 生成出来的 markup 完整性')
for (const cls of [
  'dsu-plate', 'dsu-vignette', 'dsu-black-inner', 'dsu-wash', 'dsu-brand-1', 'dsu-frame',
  'dsu-scanline', 'dsu-corner', 'dsu-slats', 'dsu-voice', 'dsu-meta', 'dsu-status-zh',
  'dsu-sub-en', 'dsu-rule', 'dsu-logo', 'dsu-dots', 'dsu-idline', 'dsu-reticle', 'dsu-hex',
  'dsu-welcome', 'dsu-w1', 'dsu-btn', 'dsu-card', 'dsu-skip', 'dsu-foot', 'dsu-sub-zh',
  'dsu-progress', 'dsu-bloom', 'dsu-streak', 'dsu-flash',
]) {
  check('markup 含 .' + cls, r.markup.includes(cls))
}

console.log('\n[3] JS 用到的每个选择器都真实存在')
check('没有落空的选择器', MISSED.size === 0, [...MISSED].join(', '))

console.log('\n[4] 没有 speechSynthesis 的环境（老浏览器 / 隐私模式）')
r = run(false)
check('初始化不抛异常', r.thrown === null, r.thrown && r.thrown.message)
check('照样摘掉黑幕', !r.root.classList.contains('dsu-boot'), '当前 class = ' + r.root._cls)
check('暴露了 API', !!r.windowStub.__DSH_STARTUP_API__)

console.log('\n[5] 音色挑选：必须跳过拼接合成音色，挑神经网络女声')
r = run(true)
let api = r.windowStub.__DSH_STARTUP_API__
check('默认 voiceName 留空 = 自动挑', api.config.voiceName === '')
api.speak('Access permission required.')
let u = r.spoken[r.spoken.length - 1]
let vname = u && u.voice ? u.voice.name : '(未设置 voice)'
check('英文挑到 Aria Online (Natural)，而不是 David/Zira', /aria/i.test(vname) && /natural|online/i.test(vname), vname)
check('不是男声 David', !/david/i.test(vname), vname)

r = run(true, { voiceLang: 'zh' })
api = r.windowStub.__DSH_STARTUP_API__
api.speak('Access permission required.', '需要访问许可')
u = r.spoken[r.spoken.length - 1]
vname = u && u.voice ? u.voice.name : '(未设置 voice)'
check('中文挑到 Xiaoxiao Online (Natural)，而不是 Huihui', /xiaoxiao/i.test(vname) && /natural|online/i.test(vname), vname)

r = run(true, { voiceLang: 'both' })
api = r.windowStub.__DSH_STARTUP_API__
api.speak('Verification passed.', '验证通过')
const names = r.spoken.map((x) => (x.voice ? x.voice.name : '')).filter(Boolean)
check('中英各念一遍 = 排了两条 utterance', r.spoken.length === 2, String(r.spoken.length))
check('中文用中文音色、英文用英文音色', names.some((n) => /xiaoxiao/i.test(n)) && names.some((n) => /aria/i.test(n)), names.join(' | '))

console.log('\n[6] 播报语调节奏与名字念法')
r = run(true)
api = r.windowStub.__DSH_STARTUP_API__
api.speak('Identity verification.')
u = r.spoken[r.spoken.length - 1]
check('语速落在电影旁白档（0.8–0.95，比朗读慢）', u.rate >= 0.8 && u.rate <= 0.95, String(u.rate))
check('音调压低（0.78–0.92，深沉）', u.pitch >= 0.78 && u.pitch <= 0.92, String(u.pitch))
check('名字全大写会转 Title Case（避免逐字母念）', api.speakName('JOYCE MOORE') === 'Joyce Moore', api.speakName('JOYCE MOORE'))
check('中文名字原样不动', api.speakName('琉璃') === '琉璃', api.speakName('琉璃'))
check('API 暴露了 voice 供设置页显示', typeof api.voice === 'string')

console.log('\n[7] 动画不许掐断语音（这是这一版的核心诉求）')
r = run(true)
api = r.windowStub.__DSH_STARTUP_API__
const speech = r.windowStub.speechSynthesis
check('voiceLead 默认 240ms（提示音后留一拍再开口）', api.config.voiceLead === 240, String(api.config.voiceLead))
speech.cancelCalls = 0
api.speak('Access permission required.')
api.speak('Identity verification.')
api.speak('Access request received.')
check('连播三句，cancel 一次都没调用（队列顺序播报）', speech.cancelCalls === 0, 'cancel ' + speech.cancelCalls + ' 次')
check('三句都排进了队列', r.spoken.length === 3, String(r.spoken.length))
speech.cancelCalls = 0
api.skip()
check('按跳过时才真的掐断（cancel 1 次）', speech.cancelCalls === 1, 'cancel ' + speech.cancelCalls + ' 次')

console.log('\n[8] 终幕用 line-6 欢迎语（自制落幕词，3.73 秒）')
{
  const src = fs.readFileSync(BUNDLE, 'utf8')
  check('全程没有 voice.tts( 调用（不再用 TTS 念白）', !/voice\.tts\(/.test(src))
  check('终幕挂了 line-6 素材', /voice\.line\(null, null, 'line-6'\)/.test(src))
  check('五步念白用各自素材', /voice\.line\(step\.say, step\.zh, step\.audio\)/.test(src))
  check('预加载包含五步与终幕', /ensureAsset\(STEPS\[i\]\.audio\)/.test(src) && /ensureAsset\('line-6'\)/.test(src))
  check('揭幕前会等欢迎语播完', /\.then\(function \(\) \{ return welcome \}\)/.test(src))
  check('五步仍然各自挂着真声素材', (src.match(/audio: 'line-/g) || []).length === 5)
  check('总共 6 份人声素材被引用', (src.match(/'line-[1-6]'/g) || []).length >= 6)
}

console.log('\n[9] 右下角身份读数：不压版心、窄窗口不丢、第 3 幕随身份核验退场')
{
  const css = fs.readFileSync(fileURLToPath(new URL('../lib/splash.css', import.meta.url)), 'utf8')
  const src = fs.readFileSync(BUNDLE, 'utf8')
  const idlineRule = (css.match(/\.dsu-idline\s*\{[^}]*\}/) || [''])[0]
  check('.dsu-idline 用 right/bottom 锚定（脱离居中版心）', /right:\s*46px/.test(idlineRule) && /bottom:\s*104px/.test(idlineRule), idlineRule.slice(0, 80))
  check('.dsu-idline 不再用 left: calc(50% + 190px)', !/left:\s*calc\(50% \+ 190px\)/.test(idlineRule))
  check('.dsu-idline 不再用 top: 49%', !/top:\s*49%/.test(idlineRule))
  check('.dsu-idline 无 translateY(-50%)（不再垂直居中）', !/translateY\(-50%\)/.test(idlineRule))
  check('.dsu-idline 右对齐成独立读数', /text-align:\s*right/.test(idlineRule))
  check('.dsu-idline.dsu-in 落到 transform: none', /\.dsu-idline\.dsu-in\s*\{[^}]*transform:\s*none/.test(css))
  check('窄窗口不再藏掉身份读数（无 display:none 规则）', !/\.dsu-idline\s*\{\s*display:\s*none/.test(css))
  check('那条 @media(max-width:1180px) 兜底已移除', !/1180px/.test(css))
  check('第 3 幕起（i >= 2）就收掉身份读数', /if \(i >= 2\) ui\.idline\.classList\.remove\('dsu-in'\)/.test(src))
  check('退场只发生在 stepLoop 开场与 finale 两处', (src.match(/ui\.idline\.classList\.remove\('dsu-in'\)/g) || []).length === 2)
}

console.log('\n[10] 桌面端标题栏同步：仅 Windows 桌面端生效、可还原、探针重挂能自愈')
{
  const CLEAR = 'rgba(0, 0, 0, 0)'
  const mkProbe = () => {
    const el = makeEl('span')
    el.isConnected = true
    el.style.setProperty('background-color', 'var(--dsw-specific-sidebar-fill)')
    return el
  }
  const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

  /* ① 浏览器（web profile）：整段空转，绝不碰探针 */
  let probe = mkProbe()
  let env = { probe, protocol: 'http:', userAgent: WIN_UA }
  let rr = run(true, {}, env)
  let chrome = rr.windowStub.__DSH_STARTUP_CHROME__
  check('暴露了 __DSH_STARTUP_CHROME__ 把手', !!chrome && typeof chrome.hide === 'function' && typeof chrome.show === 'function')
  check('浏览器环境判定为非桌面端', chrome.isDesktopWin() === false)
  check('浏览器环境不动探针底色', probe.style.getPropertyValue('background-color') === 'var(--dsw-specific-sidebar-fill)', probe.style.getPropertyValue('background-color'))

  /* ② Windows 桌面端：hide 把探针与 token 一起钉成透明 */
  probe = mkProbe()
  env = { probe, protocol: 'dsh-app:', userAgent: WIN_UA }
  rr = run(true, {}, env)
  chrome = rr.windowStub.__DSH_STARTUP_CHROME__
  const de = rr.sandbox.document.documentElement
  check('Windows 桌面端判定成立', chrome.isDesktopWin() === true)
  check('探针底色被钉成全透明', probe.style.getPropertyValue('background-color') === CLEAR, probe.style.getPropertyValue('background-color'))
  check('探针符号色也被钉透明（按钮图标不可见）', probe.style.getPropertyValue('color') === CLEAR)
  check('html 上的 token 一并设成透明（双保险）', de.style.getPropertyValue('--dsw-specific-sidebar-fill') === CLEAR)

  /* ③ 揭幕还原 */
  chrome.show()
  check('show() 清掉探针底色', probe.style.getPropertyValue('background-color') === '', JSON.stringify(probe.style.getPropertyValue('background-color')))
  check('show() 清掉探针符号色', probe.style.getPropertyValue('color') === '')
  check('show() 把 html token 也还原', de.style.getPropertyValue('--dsw-specific-sidebar-fill') === '')

  /* ④ 探针被应用重挂：缓存节点脱离文档后应重新查找（P1） */
  probe.isConnected = false
  const probe2 = mkProbe()
  env.probe = probe2
  chrome.hide()
  check('探针被重挂后能重新找到并继续生效', probe2.style.getPropertyValue('background-color') === CLEAR, probe2.style.getPropertyValue('background-color'))

  /* ⑤ macOS 桌面端：UA 不含 Win，整段空转 */
  const macProbe = mkProbe()
  rr = run(true, {}, { probe: macProbe, protocol: 'dsh-app:', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
  chrome = rr.windowStub.__DSH_STARTUP_CHROME__
  check('macOS 判定为非 Windows 桌面端', chrome.isDesktopWin() === false)
  check('macOS 不动探针', macProbe.style.getPropertyValue('background-color') === 'var(--dsw-specific-sidebar-fill)')
}

console.log('\n[11] 终幕欢迎语：素材完整性与时序')
{
  const en = fs.readFileSync(fileURLToPath(new URL('../lib/assets/line-6.mp3', import.meta.url)))
  check('line-6 是完整落幕词（>20KB；原片那句只有 13.1KB / 0.63s）', en.length > 20000, en.length + ' 字节')

  /* 2026-10-27 换入的落幕词带 ID3v2 头，帧同步不在第 0 字节 —— 要跳过 ID3 再判 */
  const mp3SyncOk = (b) => {
    let i = 0
    if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
      i = 10 + size
    }
    return i + 1 < b.length && b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0
  }
  check('MP3 帧头有效（自动跳过 ID3v2）', mp3SyncOk(en), 'first sync @' + (en[0] === 0x49 ? 'ID3 之后' : '0'))

  /* 中文素材已移除：不应再出现在发布包里 */
  const assetDir = fileURLToPath(new URL('../lib/assets/', import.meta.url))
  const zhLeft = fs.readdirSync(assetDir).filter((n) => n.endsWith('-zh.mp3'))
  check('不含中文素材（已移除）', zhLeft.length === 0, zhLeft.join(',') || '无')

  const src = fs.readFileSync(BUNDLE, 'utf8')
  const reveal = src.indexOf("ui.welcome.classList.add('dsu-in')")
  const play = src.indexOf('welcome = voice.line(')
  check('终幕人声在欢迎文案亮起之后才开念', reveal >= 0 && play > reveal, 'reveal=' + reveal + ' play=' + play)
  check('finale 开头不再提前播放（旧写法已删除）', src.indexOf('var welcome = voice.line') === -1)
  check('揭幕前仍然等欢迎语播完', /\.then\(function \(\) \{ return welcome \}\)/.test(src))
}

console.log('\n[12] 卡死防线与重播隔离（外部审查发现的坑）')
{
  const src = fs.readFileSync(BUNDLE, 'utf8')

  /* ① 停滞看门狗：不能只防「脚本没跑起来」，还要防「跑起来了但卡在中间」 */
  check('有停滞看门狗（STALL_MS 常量）', /var STALL_MS = \d+/.test(src), /var STALL_MS = (\d+)/.exec(src)?.[1])
  check('看门狗在 run() 里上弦', /function run\(\)[\s\S]{0,200}armStall\(\)/.test(src))
  check('每推进一幕重新上弦', /function stepLoop\(\)[\s\S]{0,400}armStall\(\)/.test(src))
  check('等用户操作时下弦（不踢走正在犹豫的人）', /function waitAction\(\)[\s\S]{0,300}disarmStall\(\)/.test(src))
  check('看门狗触发时走 finish()', /stallTimer = setTimeout\(function \(\) \{[\s\S]{0,400}finish\(\)/.test(src))

  /* ② 兜底判据不能是 dsu-boot 类名（它在 run() 之前就被摘掉） */
  check('兜底改判 __DSH_STARTUP_RUNNING__', /__DSH_STARTUP_RUNNING__/.test(src))
  check('兜底不再按 dsu-boot 类名判', !/classList\.contains\('dsu-boot'\)/.test(src))

  /* ③ 音频永不来 onended 时也不能把 Promise 挂死 */
  check('playAssetAndWait 有超时兜底', /buf\.duration \* 1000 \+ 1500/.test(src))
  check('resolve 只生效一次（done 守卫）', /function fin\(ms\)[\s\S]{0,120}if \(done\) return/.test(src))

  /* ④ 重播要拆旧实例，否则两套时间线互相打架 */
  check('暴露 dispose()', /dispose: dispose/.test(src))
  check('replay 前先 dispose 旧实例', /function injectSelf\(\)[\s\S]{0,400}prev\.dispose\(\)/.test(src))
  check('dispose 会停语音（避免掐掉新实例）', /function dispose\(\)[\s\S]{0,600}voice\.stop\(\)/.test(src))
  check('有代际号，旧链能自行失效', /__DSH_STARTUP_GEN__/.test(src) && /function stale\(\)/.test(src))
  check('步骤链开头检查代际', /if \(finished \|\| stale\(\)\) return/.test(src))

  /* ⑤ confirm 只能定义一次（旧实现被第二份覆盖，真素材分支成死代码） */
  check('audio.confirm 只定义一次', (src.match(/confirm: function \(\)/g) || []).length === 1, String((src.match(/confirm: function \(\)/g) || []).length))
}

console.log('\n[13] 立即预览（replay）必须真的重挂一次运行时')
{
  const r = run(true)
  const scriptsOf = (h) => h.children.filter((c) => c && String(c.tagName).toUpperCase() === 'SCRIPT')
  const before = scriptsOf(r.head).length
  const rootBefore = r.root
  const bodyBefore = r.sandbox.document.body

  check('[前置] 首轮已经暴露 replay', typeof r.windowStub.__DSH_STARTUP_API__.replay === 'function')

  /* 记录一次 appendChild 调用，判断 replay 到底有没有去挂脚本 */
  const appended = []
  const headEl = r.sandbox.document.head
  const origAppend = headEl.appendChild.bind(headEl)
  headEl.appendChild = (c) => { appended.push(c && c.tagName); return origAppend(c) }

  let err = null
  try { r.windowStub.__DSH_STARTUP_API__.replay() } catch (e) { err = e }

  check('replay 不抛异常', err === null, err && err.message)
  check('replay 真的调用了 head.appendChild', appended.length > 0, 'appendChild 调用次数 ' + appended.length)
  const after = scriptsOf(r.head)
  check('replay 追加了新的 <script>', after.length === before + 1, before + ' -> ' + after.length)
  const last = after[after.length - 1]
  check('新脚本指向 /dsh-startup/splash.js', !!last && String(last.src || '').indexOf('/dsh-startup/splash.js') === 0, last && last.src)
  check('带时间戳绕缓存（否则浏览器复用旧实例）', !!last && /splash\.js\?t=\d+/.test(String(last.src)), last && last.src)
  check('清掉了 __DSH_STARTUP_LOADED__（新脚本才会执行）', r.windowStub.__DSH_STARTUP_LOADED__ === false, String(r.windowStub.__DSH_STARTUP_LOADED__))
  check('清掉了 SKIP 标记', r.windowStub.__DSH_STARTUP_SKIP__ === false, String(r.windowStub.__DSH_STARTUP_SKIP__))
  check('旧根节点已从 body 摘下', bodyBefore.children.indexOf(rootBefore) === -1)
  check('滚动锁已解开（新实例会重新锁）', !r.sandbox.document.documentElement.classList.contains('dsu-lock') || r.sandbox.document.documentElement.classList.contains('dsu-lock') === false, r.sandbox.document.documentElement._cls)

  /* 再按一次：应该继续正常追加，而不是第二次就哑火 */
  let err2 = null
  try { r.windowStub.__DSH_STARTUP_API__.replay() } catch (e) { err2 = e }
  check('连续点两次也不抛异常', err2 === null, err2 && err2.message)
  check('连续点两次各追加一个脚本', scriptsOf(r.head).length === before + 2, String(scriptsOf(r.head).length))
}

console.log('\n[14] 液态玻璃：透出背景，但主体素材保持不透明')
{
  const g = run(true, { glass: true, glassOpacity: 0.4, glassBlur: 24, glassSaturate: 170 })
  check('开了玻璃 → 根节点带 dsu-glass', g.root.classList.contains('dsu-glass'), g.root._cls)
  check('--dsu-glass-alpha 生效', g.root.style.getPropertyValue('--dsu-glass-alpha') === '0.4', g.root.style.getPropertyValue('--dsu-glass-alpha'))
  check('--dsu-glass-blur 生效', g.root.style.getPropertyValue('--dsu-glass-blur') === '24px', g.root.style.getPropertyValue('--dsu-glass-blur'))
  check('--dsu-glass-sat 生效', g.root.style.getPropertyValue('--dsu-glass-sat') === '170%', g.root.style.getPropertyValue('--dsu-glass-sat'))
  check('开玻璃时不立即置透明（会露出 DSH 0.2.1 的启动白底）', g.root.style.background !== 'transparent', String(g.root.style.background))
  check('源码里透明是在底板 opacity=1 之后才设置', /ui\.plate\.style\.opacity = '1'[\s\S]{0,400}root\.style\.background = 'transparent'/.test(fs.readFileSync(BUNDLE, 'utf8')))

  const off = run(true)
  check('默认不开启玻璃', !off.root.classList.contains('dsu-glass'), off.root._cls)
  check('默认不动根节点背景', !off.root.style.background, String(off.root.style.background))

  /* 区间夹取：越界值也要落到合法范围 */
  const edge = run(true, { glass: true, glassOpacity: 5, glassBlur: 999, glassSaturate: 10 })
  check('不透明度被夹到 0.95', edge.root.style.getPropertyValue('--dsu-glass-alpha') === '0.95', edge.root.style.getPropertyValue('--dsu-glass-alpha'))
  check('磨砂被夹到 60px', edge.root.style.getPropertyValue('--dsu-glass-blur') === '60px', edge.root.style.getPropertyValue('--dsu-glass-blur'))
  check('饱和度被夹到 100%', edge.root.style.getPropertyValue('--dsu-glass-sat') === '100%', edge.root.style.getPropertyValue('--dsu-glass-sat'))

  /* 样式表里必须有真正的磨砂与半透明规则，而不是只改了变量 */
  const css = fs.readFileSync(fileURLToPath(new URL('../lib/splash.css', import.meta.url)), 'utf8')
  check('CSS 有 backdrop-filter 磨砂', /backdrop-filter:\s*blur\(var\(--dsu-glass-blur/.test(css))
  check('CSS 让底板半透明（用 alpha 变量）', /\.dsu-glass \.dsu-plate[\s\S]{0,400}var\(--dsu-glass-alpha/.test(css))
  check('CSS 让黑幕半透明', /\.dsu-glass \.dsu-black[\s\S]{0,200}rgba\(4, 6, 10/.test(css))
  check('CSS 有液态高光动画', /@keyframes dsu-glass-drift/.test(css))
  check('CSS 根节点背景透明', /#dsh-startup-root\.dsu-glass\s*\{\s*background:\s*transparent/.test(css))
}

console.log('\n[15] 背景模糊：独立图层，不与任何素材绑定')
{
  const bgOf = (r2) => r2.root.children.filter((c) => c && c.classList && c.classList.contains('dsu-backdrop'))[0]

  const on = run(true, { glass: true, glassBackdropBlur: 30 })
  const bg = bgOf(on)
  check('开玻璃 → 生成 .dsu-backdrop 背景层', !!bg)
  check('背景层在最底（root 第一个子节点）', on.root.children[0] === bg, on.root.children[0] && on.root.children[0]._cls)
  check('--dsu-backdrop-blur 按配置生效', on.root.style.getPropertyValue('--dsu-backdrop-blur') === '30px', on.root.style.getPropertyValue('--dsu-backdrop-blur'))
  check('背景层不带任何壁纸背景（已移除该功能）', !!bg && !String(bg.style.backgroundImage || ''), bg && bg.style.backgroundImage)

  const noGlass = run(true, { glass: false })
  check('没开玻璃 → 不生成背景层', !bgOf(noGlass))

  const clamp = run(true, { glass: true, glassBackdropBlur: 999 })
  check('背景模糊被夹到 80px', clamp.root.style.getPropertyValue('--dsu-backdrop-blur') === '80px', clamp.root.style.getPropertyValue('--dsu-backdrop-blur'))

  const css2 = fs.readFileSync(fileURLToPath(new URL('../lib/splash.css', import.meta.url)), 'utf8')
  check('CSS 有 .dsu-backdrop 图层', /\.dsu-backdrop\s*\{[\s\S]{0,400}backdrop-filter:\s*blur\(var\(--dsu-backdrop-blur/.test(css2))
  check('CSS 里已没有壁纸层 .dsu-wall', !/\.dsu-wall/.test(css2))
  check('壁纸路由已移除（splash.js 不再请求）', !fs.readFileSync(BUNDLE, 'utf8').includes('/dsh-startup/wallpaper'))
}

console.log('\n[16b] 启动期不得露出 DSH 白底（0.2.1 起 body 被强制 #fff）')
{
  const hostSrc = fs.readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')
  check('critical CSS 把启动期 body 压成黑底', /html\.dsu-lock body\{background-color:#000!important\}/.test(hostSrc))
  check('覆盖 --dsh-boot-bg 为黑色', /--dsh-boot-bg:#000/.test(hostSrc))
}

console.log('\n[16] 背景模糊必须真的生效（contain:paint 回归防线）')
{
  const css = fs.readFileSync(fileURLToPath(new URL('../lib/splash.css', import.meta.url)), 'utf8')
  const src = fs.readFileSync(BUNDLE, 'utf8')

  /* contain:paint 会把根节点变成 backdrop 根，backdrop-filter 只能采自己内部 → 表现是「只透不糊」 */
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '')
  check('CSS 不再有 contain: paint', !/contain:\s*layout\s+paint/.test(cssNoComment), (cssNoComment.match(/contain:[^;]*/g) || []).join(' | '))
  check('仍然保留 layout style 收敛', /contain:\s*layout style/.test(css))

  /* 兜底：内核不支持 backdrop-filter 时，直接模糊应用本体 */
  check('有 blurAppBackdrop 兜底', /function blurAppBackdrop\(/.test(src))
  check('背景模糊直接作用于应用本体，且上限 60（超过就成纯色）', /blurAppBackdrop\(Math\.min\(60, backdropBlur\)\)/.test(src))
  check('揭幕会还原应用本体的 filter', /function finish\(\)[\s\S]{0,400}restoreAppBackdrop\(\)/.test(src))
  check('dispose 也会还原', /function dispose\(\)[\s\S]{0,300}restoreAppBackdrop\(\)/.test(src))

  /* 第三方浮层：不糊、不改写 filter，并对外暴露配合点 */
  check('有 isForeignOverlay 判定', /function isForeignOverlay\(node\)/.test(src))
  check('支持 data-dsh-overlay 约定标记', /data-dsh-overlay/.test(src))
  check('fixed 且层级低于启动界面的按浮层处理', /position === 'fixed'/.test(src) && /z < 2147483000/.test(src))
  check('模糊循环里跳过第三方浮层', /if \(isForeignOverlay\(node\)\) continue/.test(src))
  check('启动期给 body 打标记', /setAttribute\('data-dsh-startup-running'/.test(src))
  check('收尾移除启动期标记', /removeAttribute\('data-dsh-startup-running'/.test(src))
  check('向浮层管理器登记启动界面', /window\.dshwRegisterMask\(root\)/.test(src))
  check('收尾注销登记', /typeof unregisterMask === 'function'\) unregisterMask\(\)/.test(src))
  check('创建时登记、finish 与 dispose 各撤销一次', /beginStartupExposure\(\)/.test(src) && (src.match(/endStartupExposure\(\)/g) || []).length >= 3)
}

console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
