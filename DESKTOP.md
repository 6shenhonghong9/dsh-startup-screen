# 桌面端适配说明

本插件同时支持两种 DSH：

| | web profile | desktop profile |
|---|---|---|
| 载体 | `dsh web` 起的本地服务 | DeepSeek Harness Desktop（Electron 桌面端） |
| profile 目录 | `%USERPROFILE%\.dsh\profiles\web` | `%USERPROFILE%\.dsh\profiles\desktop` |
| 安装 | `dsh plugin --profile web add …` | `dsh plugin --profile desktop add …` |
| 重启方式 | 关掉启动器窗口再重新双击 | 完全退出桌面端再打开 |

插件本体是**同一份代码**，不需要两个包。桌面端适配是在 1.1.0 完成的，
原有 web 用法、设置项、素材全部不变。

---

## 一、装到桌面端

```bash
# 1) 先完全退出 DeepSeek Harness Desktop（进程不要留着）
# 2) 再装
dsh plugin --profile desktop add ./dsh-startup-screen-1.1.0.tgz
# 3) 重新打开桌面端
```

Windows 上也可以双击 `安装.cmd`：它会自动识别 `web` / `desktop` 两个 profile
并逐个安装。

**为什么必须先退出桌面端**：desktop profile 的 `package.json` 由桌面端进程加锁
管理（`desktop-plugins.lock.json` 里记着谁装了谁）。进程在跑的时候写进去会被覆盖，
DSH 会直接报：

```
Open DeepSeek Harness Desktop once to initialize its profile,
then fully quit it before running dsh plugin --profile desktop.
```

`dsh` 本体（`npm i -g @deepseek-ai/dsh`）只是提供 `plugin` 子命令，
装的东西进的是桌面端自己的 profile，不依赖全局那份。

---

## 二、桌面端和 web 端哪里不一样

桌面端组合里同样挂 `@deepseek-ai/dsh-web-app`，所以有 `webServer` 服务，
插件注册的三条路由（`splash.css` / `splash.js` / `asset/*`）和 `/dsh-startup/config`
配置接口两边都能用，**设置页「启动动画」的表现完全一致**。

区别只在「首屏注入」这一步：

| | web | desktop |
|---|---|---|
| 注入方式 | `ctx.webServer.tapIndex` 改写 index.html | 同上；若该载体不提供 index 注入，则由浏览器半侧自举 |
| 首屏黑幕 | 应用挂载前就盖住，无白闪 | 走 index 注入时同 web；走自举时会有极短白闪（见下） |

### 具体改了什么

1. **Host 半侧允许降级**（`lib/index.js`）
   以前 `webServer` 缺失会直接抛异常 → 整颗 fiber 失败。现在取不到可用
   `webServer`（`dsh-host-webserver` 的注释明确写了 *"Electron uses file://
   plus IPC instead"*）时，Host 半侧只打一条 warn 并跳过路由注册，**插件依然
   正常 APPLIED**，页面交给浏览器半侧。

2. **浏览器半侧可以自举**（`lib/client.js`）
   Host 的 index 注入没生效时，浏览器半侧自己建 `#dsh-startup-root`、加样式、
   挂 `splash.js` 并把启动动画放起来。判定全在 window 上，不猜宿主类型：

   | 标记 | 含义 |
   |---|---|
   | `__DSH_STARTUP_BOOT__ = 'index'` | Host 已经注入过 → 半侧什么都不做 |
   | `__DSH_STARTUP_BOOT__ = 'client'` | 浏览器半侧已经自举过 |
   | `__DSH_STARTUP__` | 配置已就位 |
   | `__DSH_STARTUP_SKIP__` | Host 兜底脚本已判定「这次不播」 |

   自举时遵循和 Host 完全相同的判定：`enabled=false` 不播、`session` 本会话
   播过不播、`daily` 今天播过不播，并把同款持久化标记回填到
   `sessionStorage` / `localStorage`。

3. **首屏注入加了 BOOT 标记**
   index 注入的脚本里多了一句 `window.__DSH_STARTUP_BOOT__="index"`，
   这是两边不重复播放的握手依据。

4. **自愈兜底**：样式或脚本拉不到时，浏览器半侧会把黑幕节点和滚动锁**还回去**
   （`__DSH_STARTUP_FAILED__ = true`），不会把用户留在黑屏里。这条在 Host 侧
   原本就有，现在两侧都有。

---

## 三、设置项

与 README「设置选项」一节完全一致，桌面端在 **设置 →「启动动画」**，
配置同样落在 `%USERPROFILE%\.dsh\dsh-startup.json`
（或用 `DSH_HOME` 指到别处）。

---

## 四、验证情况（请如实看待）

| 验证项 | 状态 |
|---|---|
| 四套冒烟测试（193 项断言） | ✅ 通过 |
| 真实 `dist/index.html` 上的注入产物 | ✅ 通过（隔离环境实测） |
| 隔离 DSH 实例的真实 HTTP 全链路（index 注入 / 三条路由 / 7 段音频素材 / 配置读写 / 401 信任栅栏） | ✅ 通过 |
| 没有 `webServer` 的降级路径不抛异常 | ✅ 通过 |
| 浏览器半侧自举逻辑（DOM stub 跑真代码） | ✅ 通过 41 项断言 |
| **桌面端实机**（真实 Electron 里看到动画） | ⚠️ **未实机验证** |

最后一行的原因：写这份适配时开发机上没有装 DeepSeek Harness Desktop
（`%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop` 不存在，
`profiles\desktop` 里只剩指向它的失效联接），无法启动桌面端做端到端确认。

因此桌面端用的是「**双保险**」设计：`tapIndex` 能用就走和 web 完全相同的路径，
不能用就走浏览器半侧自举。两条路都有测试覆盖，但**真机表现**需要你自己打开
桌面端确认一次。

如果装上后没看到动画，按这个顺序排查：

1. 桌面端设置页里有没有「启动动画」这一项？没有 → 插件没装上或没重启。
2. 打开开发者工具看 console：
   - 有 `[dsh-startup-screen] 启动界面自举失败…` → 路由取不到（多半是 Host 半侧没激活）
   - 有 `当前 profile 没有可用的 webServer…` → 走了降级路径，检查浏览器半侧日志
3. 手查路由（把 `<端口>` 换成桌面端实际端口，见
   `%USERPROFILE%\.dsh\profiles\desktop\.dsh-desktop-runtime.json`）：

   ```
   http://127.0.0.1:<端口>/dsh-startup/splash.js
   ```

   返回 **401** → 路由已注册，插件是活的（401 是插件自己的信任栅栏，正常）
   返回 **404** → 没装成功，或桌面端没重启

---

## 五、测试

```bash
npm test     # host + splash + client + desktop 四套，193 项断言
```

`test/smoke-desktop-boot.mjs` 就是桌面端自举那 41 项断言的所在：
它把 `lib/client.js` 按 ModuleLoader 的方式跑起来，用最小 DOM stub 断言
「Host 没注入时自举 / Host 注入过时不重复 / 该不播时不播 / 失败时把页面还回去」。
