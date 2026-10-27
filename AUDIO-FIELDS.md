# 需要音频的字段清单

本文件列出启动动画里**所有会出声的槽位**，以及每个槽位当前用的是哪份素材。
数值与文件名直接从 `lib/splash.js` 抓取。

---

## 一、语音台词 —— 6 个槽位（前 5 句取自原片真声，终幕为自制落幕词）

素材来自你提供的 `52xo4-igqdo-001.aac`，一一对应如下：

| 槽位 | 中文主字 | 英文副标题 | 素材文件 | 源素材 | 素材时长 | 出声时机 |
|---|---|---|---|---|---|---|
| `line-1` | 需要访问许可 | `ACCESS PERMISSION REQUIRED` | `lib/assets/line-1.mp3` | V1 (7.40–9.36s) | **1.96s** | 洗白后第一步，与文字渐显同时 |
| `line-2` | 身份资料确认 | `IDENTITY VERIFICATION` | `lib/assets/line-2.mp3` | V2 (11.29–12.45s) | **1.16s** | 第二步（身份卡 + 等确认） |
| `line-3` | 接收访问需求 | `ACCESS REQUEST RECEIVED` | `lib/assets/line-3.mp3` | V4 (14.76–15.83s) | **1.07s** | 第三步（鲸鱼标识一笔画成） |
| `line-4` | 开始读取权限 | `PERMISSION READ STARTED` | `lib/assets/line-4.mp3` | V5 (17.11–18.29s) | **1.18s** | 第四步（十六进制瀑布） |
| `line-5` | 读取完毕 · 核验通过 | `READ COMPLETE · VERIFIED` | `lib/assets/line-5.mp3` | V6 (19.71–21.41s) | **1.70s** | 第五步（环形准星扫描） |
| `line-6` | 欢迎授权（终幕） | `WELCOME` | `lib/assets/line-6.mp3` | 自制落幕词（见下） | **3.73s** | 欢迎文案亮起的同一刻 |

**V3（13.04–14.09s）是用户名字独白，按你的要求不使用。**

### 素材取不到时

`voiceSource = 'asset'`（默认）时优先用素材；**五步台词**（`line-1..5`）素材缺失或解码失败会
自动回落到 TTS（`say` 字段就是回落用的文本），设置页可强制 `tts`。

**终幕 `line-6` 不会念出合成腔**：调用时 `en` / `zh` 都传 `null`，素材拿不到时
即便走到 TTS 分支也没有文本可念 —— 效果就是静音（只留画面与和声钟）。

### 终幕欢迎语（line-6）：现在用的是自制落幕词

原片里那句只有 **0.34–0.63 秒**，转写出来就是 `Welcome.` —— 说完就停，不是被截断。
直接用它会让终幕听感像「话没说完画面就跳了」。

经过两轮替换，现在用的是**上游 v1.6.0 fork 沿用的自制落幕词**：

| 项 | 值 |
|---|---|
| 时长 | **3.73 秒** |
| 编码 | MP3 192 kbps |
| 峰值 / 活跃段 RMS | −9.0 dBFS / ≈ −22.9 dB |
| 来源 | 使用者自制（非原片素材），随上游 1.1.2 起入库 |

上一版是本地用 XTTS-v2 克隆合成的 2.21 秒版本（"Welcome. Authorization granted."），
已被这条替换：它更长、更有收束感，且电平与其余五句同档。
旧素材备份在 `_bak\line-6.our-clone-2.21s.mp3`（不在发布包内）。

**时序不用改**：`finale()` 里仍是 `await welcome`，换更长的素材会自动把结尾撑开。

> 素材来源说明：克隆仅用于个人启动动画，音色参考自你提供的视频素材；
> 生成所用的 XTTS-v2 模型遵循其 CPML（非商用）条款。详见 README 的免责声明。


---

## 二、界面音效 —— 8 个槽位

| # | 槽位 | 出声时机 | 素材 | 状态 |
|---|---|---|---|---|
| 1 | `cue` | **每次念台词之前**的两声轻提示 | 合成（1046.5 + 1568 Hz） | 合成 |
| 2 | `tick` | 文字逐字渐显 | `lib/assets/sfx-tick.mp3` | ✅ 真素材 |
| 3 | `step` | 每个阶段推进 | 同上 | ✅ 真素材 |
| 4 | `confirm` | 点按钮 / 按 Enter 确认 | 同上 | ✅ 真素材 |
| 5 | `tickRun` | 十六进制瀑布开始滚动 | `lib/assets/sfx-ticks-run.mp3` | ✅ 真素材 |
| 6 | `sweep` | 黑幕 → 暖白底板的洗白过场 | 合成（带通噪声扫频） | 合成 |
| 7 | `rise` | 黑幕上 DeepSeek 标识出现 | 合成（220→990 Hz 上行） | 合成 |
| 8 | `chime` | 终幕揭幕 | 合成（三音和声钟） | 合成 |

`tick` / `step` / `confirm` 目前**共用同一个「哒」**（音量不同）。
如果想让它们各用不同音效，补素材即可。

### 为什么 4 个还是合成

你给的音频里 **0–6.90s 是纯静音**：

- `rise` 对应原片约 3.9–5.5s → **原音频那里没有声音**
- `sweep` 对应原片约 6.2–6.7s → **同上**
- `chime` 对应 22.62–27.40s，但那是**配乐**不是音效

---

## 三、素材清单

```
lib/assets/
├─ line-1.mp3          40.3 KB   V1  需要访问许可
├─ line-2.mp3          24.5 KB   V2  身份资料确认
├─ line-3.mp3          23.0 KB   V4  接收访问需求
├─ line-4.mp3          25.0 KB   V5  开始读取权限
├─ line-5.mp3          35.2 KB   V6  读取完毕 · 核验通过
├─ line-6.mp3          88.2 KB   自制落幕词（3.73s / 192kbps）
├─ sfx-tick.mp3         2.1 KB   单声「哒」（20ms，质心 7.5kHz）
└─ sfx-ticks-run.mp3   10.2 KB   整串 10 个「哒」，每 45ms 一个
```

Host 经 `/dsh-startup/asset/<文件名>` 只读下发（正则白名单 + 防目录穿越）。
前 5 段真声素材的 40–120Hz 能量都在 −25 ~ −34 dB（片尾配乐是 −1.3 dB），
**素材本身干净，没有配乐底**；`line-6` 是自制落幕词（3.73 秒），电平已与其余五句对齐。
两套语言由设置页「语音语言」整套切换，绝不混用。

---

## 四、时长怎么定

**不再写死。** 每一步的停留时间 = `max(视觉基准, 实际音频时长 + 240ms 收尾)`：

```js
var spoke = voice.line(step.say, step.zh, step.audio)   // Promise<这一句实际播了多久>
function holdFor(spoken) {
  var target = Math.max(ms(step.hold), (spoken || 0) + ms(240))
  return wait(Math.max(0, target - (spoken || 0)))
}
```

素材播多长，动画就等多久；**用户点得快也不掐断语音**。
只有「跳过 / 揭幕」才真的 `cancel()`。

按素材时长，五步的语音段落约：
`1.96s → 1.16s → 1.07s → 1.18s → 1.70s`（另加每次 240ms 的开头留白）。

---

## 五、有字但故意不配音的字段

`en`（中央大字）· `log` / `logEn`（底部日志）· `btnZh` / `btnEn`（按钮）· `badge`（阶段计数）·
`brand1/2/3`、`orgZh/orgEn/orgSub`、`welcomeBox`、`footer`（品牌与页脚）

---

## 六、相关设置项

| 设置项 | 作用 |
|---|---|
| `voice` | 语音播报总开关 |
| `voiceSource` | `asset`=优先真声素材 / `tts`=全 TTS |
| `voiceLang` | `en` / `zh` / `both`（只影响 TTS 回落时念什么） |
| `voiceName` / `voiceRate` / `voicePitch` / `voiceVolume` | TTS 音色与语调 |
| `voiceCue` | 念台词前的提示音开关 |
| `voiceLead` | 提示音之后留多久再开口（默认 240ms） |
| `sound` / `soundVolume` | 界面音效总开关与音量（**不连坐语音素材**） |
| `sfx` | 音效来源：`audio`=真素材 / `synth`=全合成 |
