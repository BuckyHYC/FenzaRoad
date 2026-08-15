# MoronTown

基于 Three.js、TypeScript 和 Vite 的 3D 驾驶游戏，包含 1200×1200 有限城市、无尽模式、AI 交通、行人、竞速、车库、GLB 车辆/行人模型与局域网多人联机。

留存系统：金币经济、车库解锁购买、14 项成就、每日挑战与连续签到、生涯统计、竞速奖励与成绩分享。进度与金币保存在浏览器本地。

多人联机使用 WebSocket，开发时直接 `npm run dev` 即可在同一端口提供房间服务；生产环境先构建再运行 `npm run serve`。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run serve
```

## 测试

```bash
npm test
```
