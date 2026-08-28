# 朋友的酒（Friends Wine）RTT 模块

原创 N 人房地产博弈。规则书原文见 [朋友的酒规则书.txt](./朋友的酒规则书.txt)（由 PDF 提取整理，
原文在「回合的最后阶段」一节截断，无后续内容）。

**编程对照用流程化规格**见 [规则文档.md](./规则文档.md)（逐条编号、公式化、含实现口径与状态机映射，改引擎/写测试以它为准）。

> **维护约定**：本目录是服务器上的实际开发副本；git 发布仓库在 `E:\financial-leverage`
> （GitHub: paipai4/-financial-leverage）。**每轮修改后须运行 `bash E:\financial-leverage\sync-from-server.sh`
> 同步并推送**，服务器端的改动不会自动进仓库。

## 文件结构（参考 paischool 的极简方式）

```
rules.js               规则引擎（RTT 加载的唯一 JS）
data.js / play.html / play.css / play.js   对局界面（DOM 渲染，无地图素材）
about.html / create.html                   关于页 / 建局页
title.sql              titles 表注册脚本
test_friends_wine.js   无头测试：基本检查 + 多种子随机压测
thumbnail.jpg          商店缩略图
```

## 剧本与角色

- 创建页「座位数量」下拉可选 2~6 人（`options.players`，城市数 = 人数 + 1）
- `exports.roles(scenario, options)` 按 `options.players` 返回前 N 个角色：
  `Wang / Li / Zhao / Sun / Qian / Zhou`；旧剧本名 `双人局/三人局/四人局` 自动兼容回退

## 引擎要点

- 全局阶段计数器 `counter` 驱动还款到期（第 r 回合拍得的贷款在 `(6-r)` 个阶段后到期）
- 状态机：`init_pick → (round loop: window → bid → transfer → sell → …) → game_over`
  - `window` 每人每阶段限打 1 张牌，无牌可打自动跳过
  - `bid` 轮流叫价/弃拍：价必须严格更高；全员弃拍即流拍回炉，下回合重洗入场
  - 土地竞拍按现金校验购买力；贷款拍至顶价 5 倍时银行关系更高者可同价抢标
- 所有 `game` 字段可 JSON 序列化；RNG 为计数器式实现存于 `game.rng`，DB 往返后确定性一致
- 政府关系压制直购、免费债务展期（银行关系 >3/>6）、维权标记三条/收回一块地等均已实现

## 与规则书的取舍（原文歧义处的处理）

1. **土地归属城市**：抽地时地块绑定来源城市，卖房/消费者池/收回都在该城结算。
2. **手牌时机**：所有牌统一在拍卖前出牌窗口打出（含非“拍卖前”标注的牌），每人每阶段 1 张。
3. **竞价平价**：严格加价制下不存在同价，规则书的“银行关系抢标”只对顶价竞拍生效；
   定向招拍/额外贷款的优先权体现在拍品队列最前（展示“优先权”）。
4. **政府压场直购**：自动结算（底价购得，房价倍数 +1），不再询问。
5. **手牌数量**：按牌面“×玩家数 / ×城市数 / ×N”每人发足，回合间累积不清零。
6. **保交楼**：只对消费者池中未交付土地强制收造房费（付不起则跳过），同时把手上的本地块强制入市回收现金。
7. **DLC**（信用评级 / 融资平台）：不实现。

## 本地测试

```bash
cd server/public/friends-wine
node test_friends_wine.js          # 全量（8 种子 × 2/3/4 人局）
node test_friends_wine.js quick    # 快速冒烟
```

## 前端与共用美工（参考 shanghai1937 / POG 惯例）

- 页面骨架、标准按钮行、日志区样式全部复用 `/common/client.css`；本模块 CSS 只写桌布底色、
  角色底色（POG 式 `#role_Wang{lightcoral}` 六色）、城市列/手牌纸感皮肤
- **交互模型（地图优先）**：绝大多数操作直接点在地图上，可点目标统一橙金高亮——
  城市列（选城/旋转门）、**每位玩家在版图上有一块「玩家面板」**（现金/地块/贷款/各城关系/
  手牌芯片一应俱全，己方面板标 ▶、行动方金边、选人时整卡可点）、消费者池地块
  （绿框=可支付造房费）；顶部 `#actions` 只保留确认/跳过型动作
  （跳过出牌、转贷三选、结束卖房）
- **竞拍弹窗**：每次竞拍弹出 `<dialog>` 模态窗口，显示拍品金额、当前最高价、已弃拍名单，
  轮到自己时窗口内出现叫价倍数按钮与弃拍；拍品结束弹窗自动关闭
- 己方回合表头变色：`body.<Role> header.your_turn` 与角色卡同色系
- 结构化日志：服务端输出 `.h1 / .h2 / *` 前缀，前端 `on_log()` 渲染成 POG 式色带

## 本地联调辅助

```bash
cd server
node create-fw-test-game.js   # 建 fw_test 用户 + 双人测试局，打印 game_id
# 直接以该 user 登录后访问 /friends-wine/play.html?game=<id>&role=Wang|Li|Observer
```

## 注册 / 卸载

```bash
cd server
sqlite3 db < public/friends-wine/title.sql   # 或 node register-friends-wine.js
# 重启服务器后 load_titles() 会加载本模块；views/index.pug 的 TAGS_BY_ID 已加入标签
```
