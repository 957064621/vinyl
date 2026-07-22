# Vinyl 项目指南

## 产品与用户流程
这是一个移动优先的黑胶歌词抽取与播放页面。用户进入后先等待五张现有 OSS 封面完成加载和解码，再进入唱盘；抽取后显示高潮或副歌摘录并播放对应 OSS 音频；歌单与歌词是全屏工作层，不是营销页面。

## 架构与文件职责
`src/main.js` 只导入样式并调用 `bootstrapApp()`。`src/app/bootstrap.js` 管理启动生命周期，`src/app/player-app.js` 组合控制器并绑定命名事件，`src/app/transitions.js` 定义完成驱动的业务时间线，`src/app/register-service-worker.js` 延迟注册回访缓存。`src/config/assets.js` 定义五张既有封面及同图派生候选；`src/media/asset-loader.js` 负责加载、解码、重试和回退；`src/player/audio-controller.js`、`turntable-controller.js`、`track-selector.js` 分别管理音频、唱盘和选曲；`src/motion/motion-controller.js` 独占并取消时间线；`src/ui/` 管理加载页、歌词层和延迟歌单；`src/data/lyrics.js` 与 `releases.js` 是内容事实来源，`src/data/cover-map.js` 是版本化 OSS 封面映射；`src/styles/` 按基础、档案视觉、唱盘、覆盖层和动效拆分。`scripts/media/build-cover-plan.mjs` 固化迁移清单，`mirror-covers.mjs` 默认 dry-run 镜像，`scripts/media/apply-metadata.mjs` 默认 dry-run 修正 inline 元数据，`verify-oss.mjs` 做发布前远端验证。完整曲库表链接见 [MUSIC_LIBRARY_AUDIT.md](MUSIC_LIBRARY_AUDIT.md)，音频表链接见 [MUSIC_AUDIO_MANIFEST.md](MUSIC_AUDIO_MANIFEST.md)。

## 本地开发与命令
要求 Node 22。`npm ci` 按锁文件安装；`npm run dev` 启动本地 Vite；`npm run test:unit` 验证数据和纯控制器；`npm run audit` 重建两份清单；`npm run audit:check` 检查清单未过期；`npm run media:mirror` 与 `npm run media:metadata` 只输出 dry-run，带 `:apply` 的命令才执行已授权 OSS 写入；`npm run media:verify` 检查 OSS 响应；`npm run build` 生成 dist；`npm run test:build` 检查单文档和大小预算；`npm run test:e2e` 执行浏览器流程；`npm run verify` 顺序执行单元、审计、构建和构建产物检查。

## GitHub Pages 与 OSS 边界
公共地址固定为 `https://957064621.github.io/vinyl/`。项目没有 ICP 备案，因此 GitHub Pages 只提供单文档应用、manifest 和 service worker；两个现有 OSS 桶只提供图像和音频，不能把大陆 OSS 默认域名当 HTML 站点。首次访问时若 `github.io` DNS 完全失败，前端代码尚未执行，无法修复；单文档构建只减少间歇性失败的请求面。

## 媒体命名、元数据与缓存
图像和 MP3 必须使用正确 Content-Type、`Content-Disposition: inline`。版本化图像使用 `public,max-age=31536000,immutable`；音频必须通过 `Range: bytes=0-0` 返回 206 和 Content-Range。新版本上线后至少保留上一发布窗口的对象，不删除仍可能被旧 HTML 引用的 key。

## 发行与歌曲数据契约
发行由 title/type/releaseDate/coverOssUrl/palette/tracks 组成。歌曲身份是 `album + trackNumber + title`，不能只用标题，因为曲库存在跨发行重复歌曲。音频由 `musicOssUrl` 明确指定。

## 高潮歌词与语义断句
歌词字段只保存高潮或副歌摘录。每个换行都是硬语义边界，行内空格是软停顿；渲染器不得拆分、合并、重排或静默删除作者行。每段最多六行，超限要编辑源歌词或调整响应式字号。

## 动效档位与性能预算
无弱动效请求的桌面细指针使用 full；触控设备、iOS、Android 和微信使用 compact；`prefers-reduced-motion` 使用 reduce。动画默认只改 transform 和 opacity；compact/reduce 禁止全屏实时模糊、背景位移和阴影动画。压缩 HTML 不超过 120 KiB；移动首屏五图目标不超过 1.2 MiB；主要交互不得出现超过 50 ms 长任务；参考设备目标 60 fps、最低持续 50 fps；隐藏层不得继续装饰动画或保留 will-change。

## 无障碍与弱动效
`prefers-reduced-motion` 使用 reduce；触控设备默认 compact；错误状态可读、可重试；关闭按钮有可访问名称；歌词字号适配容器但不按视口宽度连续缩放。

## 测试、发布、回滚
发布前依次运行 `npm run verify`、`npm run media:verify`、`npm run test:e2e`，再完成 iOS Safari、Android Chrome 和微信 WebView 真机清单。Pages 只通过 Actions 部署 dist。回滚时重新部署已验证提交，并保留该提交引用的 OSS key；service worker 不调用 skipWaiting 或 clients.claim，不在当前会话强制接管。

## 迭代历史
按仓库 diff 记录：4db78ea 初版唱盘与歌词抽取；2434dd9 将大媒体迁到 OSS；a37bc22 加入 PWA manifest；c7ac3b9 到 cd39b0a 完善移动体验、加载和封面驱动视觉；51835a1 到 0dc9495 收敛控制区闪烁、位移和回弹；7ee756c 引入 Vite、完整曲库和审计，但也把“用挚爱交换”回退并引入破坏语义行的格式器；48d1161 优化移动歌单，8e1d874 又重新启用模糊背景漂移，4f892a1 只降低其成本；f184629 固化本轮可靠性、动效和光影档案馆设计。模糊提交信息不推断未被 diff 证明的故事。

## 新增歌曲步骤
1. 在 `src/data/lyrics.js` 写入不超过六行的高潮或副歌摘录。
2. 在 `src/data/releases.js` 的正确发行中加入歌曲和稳定 trackNumber。
3. 填写经过 Range 验证的 OSS `musicOssUrl`，并确认发行 `coverOssUrl` 已存在。
4. 运行 `npm run test:unit` 和 `npm run media:verify`。
5. 运行 `npm run audit` 并检查 142 行基线按新增数量递增。
6. 本地检查抽取、播放、歌词断句、歌单选中和音频重试。
7. 提交源数据、生成审计和受影响文档，不提交凭据或媒体二进制。
