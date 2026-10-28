# 多人出行协同工具

2–6 人结伴出行的全链路工具：行程时间轴、抢票倒计时、景点舆图与足迹连线、公摊记账与自动结算、预算估算、随身向导。

**[在线体验](https://kaifeng-autumn-trip.app.workbuddy.host/)** · Node 原生 http · 原生 JavaScript · [MIT](LICENSE)

2026 年国庆开封两人实地出行用过一趟：两天行程、5 处景点、13 笔公摊，全部在这套工具里走完。

## 后端：零框架、零依赖

`server.js` 只用 Node 原生 `http` / `fs`：

- 静态资源服务（含 MIME 推断、缓存头）
- 路由分发
- 请求体解析（含大 body 分段收）
- 数据落盘：`data/db.json` 原子写，先写临时文件再 `rename`，避免写一半断电留下半个 JSON

没有 `npm install` 这一步，也没有构建过程。拷到机器上 `node server.js` 就能起，断网环境一样跑。

## 前端：原生 JS，按职责分模块

`public/js/` 下按功能拆开，内容与渲染分离：

| 文件 | 职责 |
|---|---|
| `store.js` | 状态与持久化 |
| `plan.js` / `data-days.js` | 行程时间轴 |
| `grab.js` | 车票抢票倒计时 |
| `mapview.js` / `data-map.js` | 舆图与足迹连线 |
| `expenses.js` / `dashboard.js` | 公摊记账与结算 |
| `weather.js` | 天气（带缓存） |
| `sw.js` + `manifest.webmanifest` | 离线访问、添加到主屏 |

## 环境变量

```bash
ARK_KEY2=<你的火山方舟 API Key>   # 不填则 AI 向导相关功能不可用，其余功能正常
PORT=3000                        # 默认 3000
```

仓库内不保存任何密钥。AI 部分走方舟多模型链式降级：主模型超时或报错自动切下一个，避免单点挂掉整条链路。

## 跑起来

```bash
node server.js
# 打开 http://localhost:3000
```

## 说明

- `data/` 目录不入库。里面的 `db.json` 是真实出行数据（对话记录、记账明细），只在本机保留。
- `public/img/` 的景点图片未入库。

## 许可证

MIT，见 [LICENSE](LICENSE)。
