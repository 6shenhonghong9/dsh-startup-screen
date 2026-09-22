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
    style: { setProperty() {}, removeProperty() {} },
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

function run(withSpeech, cfgOverride) {
  MARKUP = ''
  MISSED.clear()
  lookupCache.clear()
  spoken.length = 0

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
    querySelector: () => null,
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
    location: { host: '127.0.0.1:3080', href: 'http://127.0.0.1:3080/' },
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

console.log('\n[8] 终幕用真声欢迎语（来自 Video Project 3 的 line-6）')
{
  const src = fs.readFileSync(BUNDLE, 'utf8')
  check('全程没有 voice.tts( 调用（不再用 TTS 念白）', !/voice\.tts\(/.test(src))
  check('终幕挂了 line-6 素材', /voice\.line\(null, null, 'line-6'\)/.test(src))
  check('揭幕前会等欢迎语播完', /\.then\(function \(\) \{ return welcome \}\)/.test(src))
  check('预加载包含 line-6', /ensureAsset\('line-6'\)/.test(src))
  check('五步仍然各自挂着真声素材', (src.match(/audio: 'line-/g) || []).length === 5)
  check('总共 6 份人声素材被引用', (src.match(/'line-[1-6]'/g) || []).length >= 6)
}

console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
