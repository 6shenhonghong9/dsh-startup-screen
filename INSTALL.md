# 安装说明

## 一、直接安装（推荐）

```bash
dsh plugin --profile web add ./dsh-startup-screen-1.0.0.tgz
```

Windows 上双击 `安装.cmd` 也一样。

装完 **重启 dsh web**（关掉启动器窗口再重新双击）。刷新页面就能看到启动动画。

### 为什么必须用 `dsh plugin add`

DSH 靠 **`dsh.profile.bundles`** 这个层堆栈决定加载哪些插件，而
`dsh plugin add` 是 `pnpm add` 的包装，装完之后 DSH 会自动把
「声明了 `dsh.bundle` 的依赖」并入层堆栈 —— 插件自带的 `cordis.patch.yml`
就是在那时候作为一层被应用的。

**手工把目录拷进 `node_modules` 不会被识别。**

### 装完请检查一次

如果你之前是手工在 profile 的 `cordis.patch.yml` 里加了这类条目：

```yaml
- insert:
    - id: dsh-startup-screen
      name: dsh-startup-screen
```

**必须删掉。** 否则插件被注册两次，`apply` 跑两遍，
`ctx.webServer.register()` 对同一路径重复注册会报错。

`安装.cmd` 会自动检测并提示。

---

## 二、手工安装（不用 pnpm）

1. 把 `plugin/` 目录解压到任意位置
2. 让 profile 能解析到它 —— 在 `~/.dsh/profiles/web/node_modules/` 下建目录联接：

   ```cmd
   mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-startup-screen" "解压路径\plugin"
   ```

3. 在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

   ```yaml
   - insert:
       - id: dsh-startup-screen
         name: dsh-startup-screen
   ```

4. 重启 dsh web

---

## 三、验证装好了

重启后，**没带 token** 访问插件路由：

- `/dsh-startup/splash.js` 返回 **401** → 路由已注册（401 是插件自己的信任栅栏，正常）
- 返回 **404** → 没装成功，或没重启

打开页面后应该看到：黑幕 → DeepSeek 标识 → 过曝洗白 → 暖白底板 →
五步授权序列 → 揭幕。

---

## 四、卸载

```bash
dsh plugin --profile web remove dsh-startup-screen
```

走「二、手工安装」的，删掉目录联接和那两行 patch 条目即可。

---

## 五、配置项

设置页 → **启动动画**（order 26）：

| 分组 | 可调 |
|---|---|
| 播放 | 显示模式（每次会话 / 总是）、速度、是否可跳过 |
| 身份资料 | 身份名称（默认 `JOYCE MOORE`）、编号、权限等级 |
| 交互 | 是否要求点击按钮确认 |
| 语音与音效 | 语音开关、**语音来源（真声素材 / 系统 TTS）**、音色、语速、音调、音量、播报前提示音、开口前留白；界面音效开关与音量 |
| 视觉 | 主题、动效强度 |
| 文案 | 中文主字 / 英文副标题 / 日志行 / 按钮文字 |

配置落盘在 `$DSH_HOME/dsh-startup.json`（默认 `~/.dsh/dsh-startup.json`）。

---

## 六、环境要求

| 项 | 要求 |
|---|---|
| Node | **>= 20** |
| 平台 | DSH **web** profile（`dsh.client.platform = "web"`） |
| 运行时依赖 | **零**（`dependencies` / `peerDependencies` 都是空的） |
| 语音 | 浏览器 Web Speech API；Edge 里能挑到 `... Online (Natural)` 神经网络音色 |
| 真声素材 | 已内置 `lib/assets/`；**取不到会自动回落 TTS**，不影响启动 |

---

## 七、包内容

```
lib/index.js          Host 半：路由 + index.html 注入
lib/splash.js         启动动画运行时
lib/splash.css        全部样式
lib/client.js         设置面板（浏览器半）
lib/assets/           真声台词 x5 + 终幕欢迎语 + 界面音效 x2
cordis.patch.yml      bundle 层声明
preview/index.html    离线预览页
test/                 三套冒烟测试（146 项断言）
README.md             完整文档
AUDIO-FIELDS.md       需要音频的字段清单
```

跑测试：`npm test`
