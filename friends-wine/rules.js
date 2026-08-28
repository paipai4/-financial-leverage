"use strict"

/**
 * 朋友的酒（Friends Wine）- RTT 模块服务端规则引擎
 *
 * 题材：N 人房地产博弈。玩家人数 +1 个城市，每个城市有银行 / 政府 / 消费者三个池子。
 * 4 个回合，每回合正常 4 个阶段（最多追加到 6 个），阶段流程：还款 → 拍卖 → 卖房。
 * 第 4 回合最后 1 个阶段结束时现金最多者获胜；资不抵债破产、政府关系 ≤ -2 被逮捕。
 *
 * 实现取舍见 README.md（规则书原文见 朋友的酒规则书.txt）：
 *   - 土地在建立时归属某个城市（地块），卖房 / 入消费者池 / 收回都在其所属城市结算
 *   - 所有手牌都在本阶段的“拍卖前出牌窗口”打出，每人每阶段限 1 张
 *   - 政府关系压制直购为自动结算；最高价不存在平价，原“银行关系抢标”规则只对顶价竞拍生效
 */

// ---------------------------------------------------------------------------
// 常量与数据表
// ---------------------------------------------------------------------------

const DEFAULT_PLAYERS = 2
const SCENARIO_PLAYERS = { "双人局": 2, "三人局": 3, "四人局": 4 }

// 六位老板：王/李/赵/孙/钱/周
const ROLE_IDS = ["Wang", "Li", "Zhao", "Sun", "Qian", "Zhou"]
const ROLE_NAMES = {
	Wang: "王总", Li: "李总", Zhao: "徐总",
	Sun: "孙总", Qian: "张总", Zhou: "周总",
}
// 企业名（新规则）：旺达王总金、龙创李总紫、久大徐总蓝、旺柯孙总灰、币贵张总橙红、格陵兰周总翠绿
const COMPANY_NAMES = {
	Wang: "旺达", Li: "龙创", Zhao: "久大",
	Sun: "旺柯", Qian: "币贵", Zhou: "格陵兰",
}

// 最多 7 城（6 人局）。名字虚构。
const CITY_NAMES = ["东江", "南湾", "西岭", "北原", "中州", "云溪", "沧澜"]

// 解析对局的玩家数：创建页的 options.players 优先；旧剧本名次之
function resolve_players(scenario, options) {
	let opts = options
	if (typeof opts === "string") {
		try {
			opts = JSON.parse(opts)
		} catch (e) {
			opts = null
		}
	}
	let n = 0
	if (opts && typeof opts === "object" && opts.players !== undefined)
		n = parseInt(opts.players) | 0
	if (!n)
		n = SCENARIO_PLAYERS[scenario] | 0
	if (!n)
		n = DEFAULT_PLAYERS
	if (n < 2)
		n = 2
	if (n > ROLE_IDS.length)
		n = ROLE_IDS.length
	return n
}

exports.roles = function (scenario, options) {
	const n = resolve_players(scenario, options)
	return ROLE_IDS.slice(0, n)
}

exports.scenarios = ["标准局"]
exports.default_scenario = "标准局"

const START_CASH = 1000 // 万元
const MAX_HOLD_LAND = 2

// 单位：万元。新规则：贷款全部 ×城市数
const LOANS_BY_ROUND = [
	[1000, 1200, 1500, 2000],
	[2000, 2500, 3000, 4000],
	[5000, 6000, 8000, 10000],
	[15000, 20000, 30000, 40000],
]
const LOAN_COPIES_EXTRA = [0, 0, 0, 0]
const ROUND_NAMES = ["创立", "发展", "兴盛", "离场"]

// 土地构成：R1 前两档 ×(城市数+1)，其余 ×城市数
const LANDS_BY_ROUND = [
	[500, 600, 800, 1000],
	[1000, 1200, 1500, 2000],
	[2000, 2500, 3000, 5000],
	[5000, 6000, 8000, 10000],
]
const LAND_COPIES_EXTRA = [2, 0, 0, 0] // R1 的 500/600 各多 1 张（×城市数+1 → 多 C 张；2 指前两档各 +1）

// 手牌牌堆：每回合首阶段，每位玩家从本回合牌池抽 4 张并保留 4 张。
// 数量按牌面标注（players/cities 为随人数动态）
const HANDS_BY_ROUND = [
	{ weilie: "players+1", huikou: "players", chaofang: "players", peitao: 2, shangpiao: 2, xuanzhuan: 1 },
	{ weilie: "players", huikou: "players", loushi: "players-1", shuanggui: 2, jingwai: 2, dingxiang: 2, ewai: 2 },
	{ weilie: "players-1", huikou: "players-1", fangnao: "players-1", jianguan: 2, tafang: 1, zhanqi: 2, fangzhu: 3, huazhai: 1 },
	{ weilie: "players-1", huikou: "players-1", jidui: "players-2", baojiao: 3, fanfu: 2, yingzhuolu: 3, dizhichongzu: 2 },
]

// 卡牌定义。targets：出牌所需追加选择；when：出牌时机（pre_auction/auction/pre_repay/repay/pre_sell/sell/any）
// news：卡牌三段结构的第三段（额外新闻文案）
const CARDS = {
	weilie: { name: "围猎", desc: "拍卖前打出，选择1个城市，本地关系+1", when: "auction", targets: ["city"],
		news: "【我就喜欢喝这个，有一股酱香。】【已严肃摆放鱼头。】【学外语好啊，外语得学。】" },
	huikou: { name: "回扣", desc: "拍卖前打出，选择1个城市，银行关系+1", when: "auction", targets: ["city"],
		news: "【我哪是贷贵行款，还不是贷给您的。】【不是说您老婆经营水平不行，我能不能只给她分红？】【您闺女就是我闺女，在波士顿的生活费我包了。】" },
	chaofang: { name: "炒房团", desc: "拍卖前打出，选择1个城市，房价倍数+2", when: "auction", targets: ["city"],
		news: "【大盘还要涨，要涨到十万一平！】【现在再不买来不及了！】【我要买三套。】" },
	loushi: { name: "楼市大热", desc: "卖房前打出，选择1个城市，房价倍数+3", when: "sell", targets: ["city"],
		news: "【现在买房就是抄底！】【这里都是炒期房的，哪里有什么现房？】【刚需就是刚需，四个钱包启动！】" },
	peitao: { name: "配套商圈", desc: "卖房前打出，选择一块没放在消费者区的己方土地，立刻获得等同于底价的现金", when: "sell", targets: ["handland"],
		news: "【我们要在这里建一个巨型商圈，你不信可以看模型。】【虽然现在这里没有居民，商圈建起来就有了。】" },
	shangpiao: { name: "商票垫资", desc: "任一步骤前打出，立刻获得500万×回合数的现金", when: "any", targets: [],
		news: "【你拿着这个商票，到期了直接找我们名下任何一家兑款。】【家大业大的，还能赖你吗？】" },
	xuanzhuan: { name: "旋转门", desc: "任一步骤前打出，将1点本地关系兑换为同城2点银行关系，或反之", when: "any", targets: ["rot"],
		news: "【XXX长期在金融系统工作，此次调动有利于地方经济工作。】" },
	shuanggui: { name: "双规", desc: "任一步骤前打出，选择1个城市，对1个指定玩家的本地关系-2", when: "any", targets: ["city", "player"],
		news: "【经查，XXX丧失理想信念，背弃初心使命】【身后有余忘缩手，眼前无路想回头。】" },
	jingwai: { name: "境外融资", desc: "任一步骤前打出，立刻获得200万×(银行关系之和)的现金", when: "any", targets: [],
		news: "【我们公司已经在美国上市。】【我们公司已经在香港上市。】" },
	dingxiang: { name: "定向招拍", desc: "拍卖前打出，指定1个城市抽取1块土地并立刻拍卖，对这块土地优先于其他玩家取得", when: "auction", targets: ["city"],
		news: "【哎呀我早说就你们公司适合开发区那块地。】【我们三个小时前就在网上公示招标了，没看见是你的事。】" },
	ewai: { name: "特批贷款", desc: "拍卖前打出，指定1个城市抽取1笔贷款并在这一阶段拍卖，对这笔贷款优先于其他玩家取得", when: "auction", targets: ["city"],
		news: "【我说这是助农专项贷款。】【还不上再给你贷一笔，别说我批的。】" },
	fangnao: { name: "房闹", desc: "任一步骤前打出，选择1个城市，每个消费者池中的土地获得1个维权标记", when: "any", targets: ["city"],
		news: "【RNM，退钱！】【你们宁肯雇人看工地也不施工啊？】" },
	jianguan: { name: "金融监管", desc: "任一步骤前打出，选择1个城市，对1个指定玩家的银行关系减半(向上取整)", when: "any", targets: ["city", "player"],
		news: "【严厉整顿无资质放贷。】【什么叫没抵押信用贷款连批放？】" },
	tafang: { name: "塌方型腐败", desc: "任一步骤前打出，选择1个城市，所有玩家的本地关系重置清零", when: "any", targets: ["city"],
		news: "【性质极其恶劣，影响极坏，形成小团伙。】" },
	zhanqi: { name: "展期谈判", desc: "还款前打出，选择1笔贷款的还款标记，移动到2个阶段后", when: "repay", targets: ["ownloan"],
		news: "【贷款不是不还，是缓还、待还、有策略地还。】【你再借我一笔我就把上笔还给你。】" },
	fangzhu: { name: "房住不炒", desc: "卖房前打出，指定1个城市，房价倍数-3，最低不得低于1", when: "sell", targets: ["city"],
		news: "【我不明白，为什么大家都在说大盘寒冬。】【房子是用来住的、不是用来炒的。】【不要怕，是技术性调整。】" },
	huazhai: { name: "化债工作组", desc: "还款前打出，选择1笔贷款取消其还款标记，所有城市的银行关系-1", when: "repay", targets: ["ownloan"],
		news: "【为了社会效益考虑，各债权方应当顾全大局。】" },
	jidui: { name: "挤兑", desc: "还款前打出，选择1笔贷款，立刻偿付，否则破产", when: "repay", targets: ["anyloan"],
		news: "【我听说你们工资都发不出来了！】【我们公司的财务很正常啊？老板只是出国考察了！】" },
	baojiao: { name: "保交楼", desc: "强制1个城市内持有地皮的所有玩家，将造房费用立刻支付到消费者池，否则破产", when: "any", targets: ["city"],
		news: "【我立下军令状，保证交楼。】【就算企业跑了，地方不会不管你们的。】【上面有专项资金来给你们兜底造完的。】" },
	fanfu: { name: "金融反腐", desc: "选择1个城市，所有银行关系清零", when: "any", targets: ["city"],
		news: "【他们彼此之间对请托事项“心知肚明”“心领神会”，却绝不挑明。】【信贷领域是金融干部违法违规的重灾区，“靠金融吃金融”情况频发。】" },
	yingzhuolu: { name: "硬着陆", desc: "卖房前打出，指定1个城市，房价倍数变为2/3(向上取整)", when: "sell", targets: ["city"],
		news: "【这个地方已经跌到五年前的一半了。】【只要我是自住刚需，就没有亏本！】【我的房贷已经比房子贵了！】" },
	dizhichongzu: { name: "抵押重组", desc: "破产前打出，将2块土地(可以是消费者池内的)无回报弃置，取消本次破产，现金归0", when: "any", targets: ["2land"],
		news: "【我们已经尽了最大努力来偿还债务。】【真的没有钱了！】" },
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function fmt_cash(n) {
	if (n >= 10000) {
		const yi = Math.floor(n / 10000)
		const rem = n % 10000
		return rem > 0 ? `${yi}亿${rem}万` : `${yi}亿`
	}
	return `${n}万`
}

function fmt_mult(m10) {
	return (m10 / 10).toFixed(1)
}

// 可序列化的确定性随机数：状态存于 game.rng，JSON 往返后保持一致
function rng_next(game) {
	let x = (game.rng | 0) + 0x6D2B79F5 | 0
	game.rng = x
	let t = Math.imul(x ^ (x >>> 15), 1 | x)
	t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function shuffled(game, list) {
	const a = list.slice()
	for (let i = a.length - 1; i > 0; --i) {
		const j = Math.floor(rng_next(game) * (i + 1))
		const tmp = a[i]
		a[i] = a[j]
		a[j] = tmp
	}
	return a
}

function hash_seed(seed) {
	const s = String(seed === undefined || seed === null ? "" : seed)
	let h = 2166136261
	for (let i = 0; i < s.length; ++i) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h | 0
}

function alive_players(game) {
	return game.order.filter((p) => game.alive[p])
}

function other_alive(game, pid) {
	return game.order.filter((p) => p !== pid && game.alive[p])
}

function next_player(game, pid) {
	const i = game.order.indexOf(pid)
	for (let k = 1; k <= game.order.length; ++k) {
		const q = game.order[(i + k) % game.order.length]
		if (game.alive[q])
			return q
	}
	return null
}

function city_of(game, cid) {
	return game.cities.find((c) => c.id === cid)
}

function log_name(pid) {
	return ROLE_NAMES[pid] || pid
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

exports.setup = function (seed, scenario, options) {
	const n = resolve_players(scenario, options)
	const ncities = n + 1

	const game = {
		title: "friends-wine",
		seed: String(seed),
		scenario,
		options: options || {},
		state: "init_pick",
		active: ROLE_IDS[0],
		round: 0,
		phase: 0,
		counter: 0, // 已开始的阶段总数（全局），用于还款到期计算
		seq: 1,
		rng: hash_seed(seed),
		order: ROLE_IDS.slice(0, n),
		cash: {},
		alive: {},
		hand: {},
		played: {}, // 本阶段已被打出的牌 uid -> player
		picked: [], // 初设中已选免费土地的玩家
		cities: [],
		loans: [],
		leftover: [], // 流拍/被收回的地块 {kind:'loan'|'land', value}
		priority_q: [],
		pending: null,
		aq: null,
		bid: null,
		log: [],
		result: null,
		victory: null,
	}

	for (const p of game.order) {
		game.alive[p] = true
		game.cash[p] = START_CASH
		game.hand[p] = []
	}

	for (let i = 0; i < ncities; ++i) {
		const c = {
			id: "c" + (i + 1),
			name: CITY_NAMES[i] || ("新城" + (i + 1)),
			housing: 1,
			bank: [],
			gov: [],
			gov_rel: {},
			bank_rel: {},
			consumer: [],
			markers: {},
		}
		for (const p of game.order) {
			c.gov_rel[p] = 0
			c.bank_rel[p] = 0
			c.markers[p] = 0
		}
		game.cities.push(c)
	}

	game.log.push(`【朋友的酒】${n} 位老板开局，共 ${ncities} 座城市。每人初始资金 ${fmt_cash(START_CASH)}。`)
	game.log.push(`初设：请 ${log_name(game.active)} 选择一个城市免费抽取一块土地。`)

	// 第一回合的贷款/土地先洗入并分配到城市池，之后各玩家从中免费抽地
	const decks = build_round_decks(game, 1)
	deal_round_cards(game, decks)
	return game
}

// ---------------------------------------------------------------------------
// 牌堆构建与发牌
// ---------------------------------------------------------------------------

function build_round_decks(game, round) {
	const c = game.cities.length
	const loans = []
	const lands = []
	for (let i = 0; i < LOANS_BY_ROUND[round - 1].length; ++i) {
		const v = LOANS_BY_ROUND[round - 1][i]
		const copies = c + LOAN_COPIES_EXTRA[round - 1]
		for (let k = 0; k < copies; ++k)
			loans.push(v)
	}
	// 土地：R1 前两档（500/600）×(城市数+1)，其余 ×城市数
	for (let i = 0; i < LANDS_BY_ROUND[round - 1].length; ++i) {
		const v = LANDS_BY_ROUND[round - 1][i]
		const extra = i < LAND_COPIES_EXTRA[round - 1] ? 1 : 0
		for (let k = 0; k < c + extra; ++k)
			lands.push({ base: v })
	}

	// 上一轮流拍 / 被收回的牌重洗进牌堆
	for (const x of game.leftover.splice(0)) {
		if (x.kind === "loan")
			loans.push(x.value)
		else
			lands.push(x.value)
	}
	return { loans: shuffled(game, loans), lands: shuffled(game, lands) }
}

// 从左到右均匀分配到各个城市
function deal_round_cards(game, decks) {
	const cs = game.cities
	decks.loans.forEach((v, i) => cs[i % cs.length].bank.push(v))
	decks.lands.forEach((l, i) => {
		const city = cs[i % cs.length]
		city.gov.push({ uid: "L" + game.seq++, base: l.base, city: city.id })
	})
}

// 每回合首阶段：每位玩家从本回合手牌牌池抽 4 张（并保留 4 张）
function deal_hands(game, round) {
	const counts = HANDS_BY_ROUND[round - 1]
	const n = game.order.length
	const pool = []
	for (const key in counts) {
		let num
		if (counts[key] === "players")
			num = n
		else if (counts[key] === "players+1")
			num = n + 1
		else if (counts[key] === "players-1")
			num = n - 1
		else if (counts[key] === "players-2")
			num = n - 2
		else
			num = counts[key]
		if (num < 0)
			num = 0
		for (let i = 0; i < num; ++i)
			pool.push({ uid: "H" + game.seq++, card: key })
	}
	const shuffled_pool = shuffled(game, pool)
	for (const p of alive_players(game)) {
		// 每人从池顶抽 4 张并保留
		for (let i = 0; i < 4 && shuffled_pool.length > 0; ++i)
			game.hand[p].push(shuffled_pool.shift())
	}
}

// 土地入手的唯一表达：card 字段编码土地信息
function land_card_code(base, cid) {
	return "__land__:" + base + ":" + cid
}

function is_land_card(h) {
	return typeof h.card === "string" && h.card.startsWith("__land__")
}

function land_base(h) {
	return Number(h.card.split(":")[1])
}

function land_city(h) {
	return h.card.split(":")[2]
}

// ---------------------------------------------------------------------------
// 引擎推进
// ---------------------------------------------------------------------------

function begin_round(game) {
	game.round++
	const r = game.round
	game.phase = 0
	game.log.push("")
	game.log.push(`.h1 第 ${r} 回合 · ${ROUND_NAMES[r - 1]}`)
	deal_round_cards(game, build_round_decks(game, r))
	deal_hands(game, r)
	begin_phase(game)
}

// 第 1 回合的牌在 setup 已分配，初设抽地后直接进入阶段
function begin_first_round_after_setup(game) {
	game.round = 1
	game.phase = 0
	game.log.push("")
	game.log.push(".h1 第 1 回合 · " + ROUND_NAMES[0])
	deal_hands(game, 1)
	begin_phase(game)
}

function any_pooled_cards(game) {
	for (const c of game.cities)
		if (c.bank.length > 0 || c.gov.length > 0)
			return true
	return false
}

function begin_phase(game) {
	game.phase++
	game.counter++
	game.played = {}
	game.pending = null
	game.priority_q = []

	game.log.push(`.h2 ★ 第 ${game.round} 回合 · 第 ${game.phase} 阶段 ★`)
	// 阶段流程（新规则）：出牌窗口（拍卖前）→ 拍卖 → 还款 → 卖房
	build_auctions_and_window(game)
}

function repay_step(game) {
	for (;;) {
		const due = game.loans
			.filter((l) => game.alive[l.owner] && l.due <= game.counter)
			.sort((a, b) => a.due - b.due || a.uid.localeCompare(b.uid))[0]
		if (!due)
			break
		const owed = due.principal * due.mult10 / 10
		const owner = due.owner
		const city = city_of(game, due.city)
		if (game.cash[owner] >= owed) {
			game.cash[owner] -= owed
			game.loans.splice(game.loans.indexOf(due), 1)
			game.log.push(`${log_name(owner)} 偿付 ${city.name} 的贷款 ${fmt_cash(due.principal)}×${fmt_mult(due.mult10)}=${fmt_cash(owed)}。`)
		} else {
			const rel = city.bank_rel[owner]
			const tier = rel > 6 ? 2 : rel > 3 ? 1 : 0
			if (tier > 0 && due.last_defer !== game.counter) {
				due.last_defer = game.counter
				due.due += tier
				game.log.push(`${log_name(owner)} 无力偿付，凭银行关系 ${rel} 免费展期 ${tier} 阶段。`)
			} else {
				game.loans.splice(game.loans.indexOf(due), 1)
				eliminate(game, owner, "资不抵债无法偿付贷款，宣告破产")
			}
		}
	}
}

// 构建本阶段拍卖队列并进入出牌窗口
function build_auctions_and_window(game) {
	const list = []
	for (const c of game.cities) {
		if (c.bank.length > 0)
			list.push({ kind: "loan", city: c.id, principal: c.bank.shift() })
		if (c.gov.length > 0)
			list.push({ kind: "land", city: c.id, land: c.gov.shift() })
	}
	game.aq = { list: null, flipped: list, idx: -1 }
	window_open(game)
}

function window_open(game) {
	// 出牌窗口按座次从轮换起点走一圈；无牌可打的玩家自动跳过
	const n = game.order.length
	game.window = { order: [], i: 0 }
	for (let k = 0; k < n; ++k) {
		const p = game.order[(game.counter * 7 + k) % n] // 常数错开轮换起点
		if (game.alive[p])
			game.window.order.push(p)
	}
	window_advance(game)
}

function window_advance(game) {
	const w = game.window
	while (w.i < w.order.length) {
		const p = w.order[w.i]
		if (playable_cards(game, p).length > 0) {
			game.active = p
			game.state = "window"
			return
		}
		w.i++
	}
	game.window = null
	start_auction_queue(game)
}

// 玩家跳过窗口
function window_finish_player(game) {
	game.window.i++
	window_advance(game)
}

// 每人每个投资阶段限打 1 张牌
function has_played_this_phase(game, pid) {
	for (const uid in game.played)
		if (game.played[uid] === pid)
			return true
	return false
}

function playable_cards(game, pid) {
	if (has_played_this_phase(game, pid))
		return []
	return game.hand[pid].filter((h) => {
		if (!CARDS[h.card])
			return false
		return legal_targets(game, CARDS[h.card], pid) !== null
	})
}

// 合法目标集合；null 表示当前不可打出
function legal_targets(game, def, pid) {
	switch (def.targets[0]) {
	case "city":
		if (def.targets.includes("player")) {
			const victims = other_alive(game, pid)
			if (victims.length === 0)
				return null
			return { cities: game.cities.map((c) => c.id), players: victims }
		}
		if (def === CARDS.dingxiang) {
			return game.cities.some((c) => c.gov.length > 0)
				? { cities: game.cities.filter((c) => c.gov.length > 0).map((c) => c.id) }
				: null
		}
		if (def === CARDS.ewai) {
			return game.cities.some((c) => c.bank.length > 0)
				? { cities: game.cities.filter((c) => c.bank.length > 0).map((c) => c.id) }
				: null
		}
		return { cities: game.cities.map((c) => c.id) }
	case "handland": {
		const lands = game.hand[pid].filter(is_land_card)
		return lands.length > 0 ? { lands: lands.map((h) => h.uid) } : null
	}
	case "rot": {
		const rb = []
		const rg = []
		for (const c of game.cities) {
			if (c.gov_rel[pid] >= 1)
				rb.push(c.id)
			if (c.bank_rel[pid] >= 1)
				rg.push(c.id)
		}
		return rb.length + rg.length > 0 ? { rot_bank: rb, rot_gov: rg } : null
	}
	case "ownloan": {
		const mine = game.loans.filter((l) => l.owner === pid && game.alive[l.owner])
		return mine.length > 0 ? { loans: mine.map((l) => l.uid) } : null
	}
	case "anyloan": {
		const any = game.loans.filter((l) => game.alive[l.owner])
		return any.length > 0 ? { loans: any.map((l) => l.uid) } : null
	}
	case "2land": {
		// 抵押重组：需要至少 2 块土地（手上或消费者池）
		let n = game.hand[pid].filter(is_land_card).length
		for (const c of game.cities)
			n += c.consumer.filter((t) => t.owner === pid).length
		return n >= 2 ? {} : null
	}
	default:
		return {}
	}
}

// ---------------------------------------------------------------------------
// 拍卖队列执行
// ---------------------------------------------------------------------------

function start_auction_queue(game) {
	// 定向招拍 / 额外贷款抽出的拍品享有优先权，排在最前
	const list = game.priority_q.slice()
	game.priority_q = []
	list.push(...game.aq.flipped)
	game.aq.list = list
	run_auctions(game)
}

function run_auctions(game) {
	const aq = game.aq
	aq.idx++
	if (aq.idx >= aq.list.length) {
		game.aq = null
		// 拍卖结束 → 还款步骤
		repay_step(game)
		if (alive_players(game).length === 0) {
			end_round_check(game)
			return
		}
		sell_start(game)
		return
	}
	open_bid(game, aq.list[aq.idx])
}

function open_bid(game, entry) {
	const c = city_of(game, entry.city)

	if (entry.kind === "land") {
		// 政府关系压制：高于其他所有存活玩家至少 2 级 → 底价直购
		const dom = game.order.find((p) =>
			game.alive[p] &&
			game.cash[p] >= entry.land.base &&
			game.order.every((q) => q === p || !game.alive[q] || c.gov_rel[p] >= c.gov_rel[q] + 2))
		if (dom) {
			game.cash[dom] -= entry.land.base
			acquire_land(game, dom, entry.land)
			add_housing(game, c, 1)
			game.log.push(`${c.name} 翻出土地（底价 ${fmt_cash(entry.land.base)}）：${log_name(dom)} 政府关系压制，以底价直接购得！`)
			run_auctions(game)
			return
		}
	}

	game.bid = {
		kind: entry.kind,
		city: entry.city,
		principal: entry.principal || 0,
		land: entry.land || null,
		mult: 0, // 贷款为倍数×10（15~50）；土地为整数倍数（2~10）
		high: null,
		passed: [],
		cur: null,
	}
	game.bid.cur = first_bidder(game)
	game.state = "bid"
	game.active = game.bid.cur
	game.bid_history = [] // 本次拍卖的出价历史
	const what = entry.kind === "loan"
		? `贷款 ${fmt_cash(entry.principal)}`
		: `土地（底价 ${fmt_cash(entry.land.base)}）`
	game.log.push(`🃏 ${c.name} 翻开${what}，开始竞拍。`)
}

function bid_eligible(game, p) {
	const bid = game.bid
	return game.alive[p] && p !== bid.high && bid.passed.indexOf(p) < 0
}

function first_bidder(game) {
	const n = game.order.length
	for (let k = 0; k < n; ++k) {
		const p = game.order[(game.aq.idx + k) % n]
		if (bid_eligible(game, p))
			return p
	}
	return null
}

function next_bidder(game, from) {
	const n = game.order.length
	const i = game.order.indexOf(from)
	for (let k = 1; k <= n; ++k) {
		const p = game.order[(i + k) % n]
		if (bid_eligible(game, p))
			return p
	}
	return null
}

function close_or_continue(game) {
	const bid = game.bid
	const nxt = next_bidder(game, bid.cur)
	if (nxt) {
		bid.cur = nxt
		game.active = nxt
		game.state = "bid"
		return
	}
	close_bid(game)
}

function close_bid(game) {
	const bid = game.bid
	game.bid = null
	const c = city_of(game, bid.city)

	if (bid.high === null) {
		// 全员弃拍 → 流拍，回炉下回合重洗
		game.leftover.push(bid.kind === "loan"
			? { kind: "loan", value: bid.principal }
			: { kind: "land", value: { base: bid.land.base, city: bid.city } })
		game.log.push(`${c.name} 的${bid.kind === "loan" ? "贷款" : "土地"}流拍。`)
		run_auctions(game)
		return
	}

	const winner = bid.high

	// 规则补遗：贷款拍至顶价（5 倍）时，银行关系更高者可同价抢标
	if (bid.kind === "loan" && bid.mult === 50) {
		const rival = other_alive(game, winner)
			.filter((p) => c.bank_rel[p] > c.bank_rel[winner])
			.sort((a, b) => c.bank_rel[b] - c.bank_rel[a])[0]
		if (rival) {
			game.log.push(`${log_name(rival)} 凭更高的银行关系（${c.bank_rel[rival]} > ${c.bank_rel[winner]}）以同样顶价抢得贷款！`)
			award_loan(game, rival, bid, c)
			return
		}
	}

	if (bid.kind === "loan")
		award_loan(game, winner, bid, c)
	else
		award_land(game, winner, bid, c)
}

function award_loan(game, winner, bid, c) {
	game.cash[winner] += bid.principal
	const loan = {
		uid: "K" + game.seq++,
		owner: winner,
		city: bid.city,
		principal: bid.principal,
		mult10: bid.mult,
		due: game.counter + 6 - game.round,
		last_defer: -1,
	}
	game.loans.push(loan)
	c.bank_rel[winner] += 1
	game.log.push(`${log_name(winner)} 以偿还倍数 ${fmt_mult(bid.mult)} 拍得 ${c.name} 贷款 ${fmt_cash(bid.principal)}，${(6 - game.round)} 个阶段后到期。银行关系 +1。`)
	game.pending = { type: "transfer", uid: loan.uid }
	game.state = "transfer"
	game.active = winner
}

function acquire_land(game, pid, land) {
	game.hand[pid].push({ uid: land.uid, card: land_card_code(land.base, land.city) })
}

function add_housing(game, c, sold_mult) {
	const extra = sold_mult >= 8 ? 3 : sold_mult >= 4 ? 2 : 1
	c.housing += extra
	game.log.push(`${c.name} 房价倍数 → ${c.housing}（成交 +${extra}）。`)
}

function award_land(game, winner, bid, c) {
	const m = bid.mult
	const cost = bid.land.base * m
	game.cash[winner] -= cost
	acquire_land(game, winner, bid.land)
	add_housing(game, c, m)
	game.log.push(`${log_name(winner)} 以 ${m} 倍（${fmt_cash(cost)}）购得 ${c.name} 的土地。`)
	run_auctions(game)
}

// ---------------------------------------------------------------------------
// 卡牌打出与效果
// ---------------------------------------------------------------------------

function consume_card(game, pid, uid) {
	const idx = game.hand[pid].findIndex((h) => h.uid === uid)
	if (idx < 0)
		throw new Error("手上没有这张牌：" + uid)
	game.played[uid] = pid
	return game.hand[pid].splice(idx, 1)[0]
}

function apply_card(game, pid, item, tgt) {
	const key = item.card
	const def = CARDS[key]

	switch (key) {
	case "weilie":
		city_of(game, tgt.city).gov_rel[pid] += 1
		game.log.push(`${log_name(pid)} 打出【围猎】：${city_of(game, tgt.city).name} 政府关系 +1。`)
		break
	case "huikou":
		city_of(game, tgt.city).bank_rel[pid] += 1
		game.log.push(`${log_name(pid)} 打出【回扣】：${city_of(game, tgt.city).name} 银行关系 +1。`)
		break
	case "chaofang":
		city_of(game, tgt.city).housing += 2
		game.log.push(`${log_name(pid)} 打出【炒房团】：${city_of(game, tgt.city).name} 房价倍数 +2 → ${city_of(game, tgt.city).housing}。`)
		break
	case "loushi":
		city_of(game, tgt.city).housing += 3
		game.log.push(`${log_name(pid)} 打出【楼市大热】：${city_of(game, tgt.city).name} 房价倍数 +3 → ${city_of(game, tgt.city).housing}。`)
		break
	case "peitao": {
		const h = game.hand[pid].find((x) => x.uid === tgt.land)
		if (!h || !is_land_card(h))
			throw new Error("没有这块土地")
		const gain = land_base(h)
		game.hand[pid].splice(game.hand[pid].indexOf(h), 1)
		game.cash[pid] += gain
		game.log.push(`${log_name(pid)} 打出【配套商圈】：${city_of(game, land_city(h)).name} 土地变现 ${fmt_cash(gain)}。`)
		break
	}
	case "shangpiao": {
		const gain = 500 * Math.max(1, game.round)
		game.cash[pid] += gain
		game.log.push(`${log_name(pid)} 打出【商票垫资】：获得 ${fmt_cash(gain)}。`)
		break
	}
	case "jingwai": {
		let s = 0
		for (const c of game.cities)
			s += c.bank_rel[pid]
		game.cash[pid] += 200 * s
		game.log.push(`${log_name(pid)} 打出【境外融资】：银行关系合计 ${s}，获得 ${fmt_cash(200 * s)}。`)
		break
	}
	case "xuanzhuan": {
		const c = city_of(game, tgt.city)
		if (tgt.dir === "to_bank") {
			c.gov_rel[pid] -= 1
			c.bank_rel[pid] += 2
			game.log.push(`${log_name(pid)} 打出【旋转门】：${c.name} 政府关系 -1、银行关系 +2。`)
		} else {
			c.bank_rel[pid] -= 1
			c.gov_rel[pid] += 2
			game.log.push(`${log_name(pid)} 打出【旋转门】：${c.name} 银行关系 -1、政府关系 +2。`)
		}
		break
	}
	case "shuanggui": {
		const c = city_of(game, tgt.city)
		c.gov_rel[tgt.player] -= 2
		game.log.push(`${log_name(pid)} 打出【双规】：${log_name(tgt.player)} 在 ${c.name} 政府关系 -2 → ${c.gov_rel[tgt.player]}。`)
		break
	}
	case "dingxiang": {
		const c = city_of(game, tgt.city)
		const land = c.gov.shift()
		if (!land)
			throw new Error("该城市已没有土地")
		game.log.push(`${log_name(pid)} 打出【定向招拍】：抽出 ${c.name} 土地（底价 ${fmt_cash(land.base)}）立即拍卖。`)
		game.priority_q.push({ kind: "land", city: c.id, land, priority: pid })
		break
	}
	case "ewai": {
		const c = city_of(game, tgt.city)
		const principal = c.bank.shift()
		if (typeof principal !== "number")
			throw new Error("该城市已没有贷款")
		game.log.push(`${log_name(pid)} 打出【额外贷款】：抽出 ${c.name} 贷款 ${fmt_cash(principal)} 立即拍卖。`)
		game.priority_q.push({ kind: "loan", city: c.id, principal, priority: pid })
		break
	}
	case "fangnao": {
		const c = city_of(game, tgt.city)
		const cnt = c.consumer.length
		for (const t of c.consumer)
			if (game.alive[t.owner])
				c.markers[t.owner] += 1
		game.log.push(`${log_name(pid)} 打出【房闹】：${c.name} 消费者池 ${cnt} 块土地各添 1 个维权标记。`)
		break
	}
	case "jianguan": {
		const c = city_of(game, tgt.city)
		const before = c.bank_rel[tgt.player]
		c.bank_rel[tgt.player] = Math.ceil(before / 2)
		game.log.push(`${log_name(pid)} 打出【金融监管】：${log_name(tgt.player)} 在 ${c.name} 银行关系减半 → ${c.bank_rel[tgt.player]}。`)
		break
	}
	case "tafang": {
		const c = city_of(game, tgt.city)
		for (const p of game.order)
			c.gov_rel[p] = 0
		game.log.push(`${log_name(pid)} 打出【塌方型腐败】：${c.name} 全体政府关系清零。`)
		break
	}
	case "zhanqi": {
		const loan = game.loans.find((l) => l.uid === tgt.loan)
		if (!loan)
			throw new Error("找不到这笔贷款")
		loan.due += 2
		game.log.push(`${log_name(pid)} 打出【展期谈判】：一笔贷款还款推迟 2 个阶段。`)
		break
	}
	case "fangzhu": {
		const c = city_of(game, tgt.city)
		c.housing = Math.max(1, c.housing - 3) // 新规则：-3，最低 1
		game.log.push(`${log_name(pid)} 打出【房住不炒】：${c.name} 房价倍数 -3 → ${c.housing}。`)
		break
	}
	case "huazhai": {
		const loan = game.loans.find((l) => l.uid === tgt.loan)
		if (!loan)
			throw new Error("找不到这笔贷款")
		// 取消该笔贷款的还款标记（移除贷款）
		game.loans.splice(game.loans.indexOf(loan), 1)
		for (const c of game.cities)
			for (const p of game.order)
				c.bank_rel[p] = Math.max(0, c.bank_rel[p] - 1)
		game.log.push(`${log_name(pid)} 打出【化债工作组】：取消一笔贷款还款标记，全体银行关系 -1。`)
		break
	}
	case "jidui": {
		const loan = game.loans.find((l) => l.uid === tgt.loan)
		if (!loan)
			throw new Error("找不到这笔贷款")
		// 挤兑：立刻偿付，否则破产
		const owed = loan.principal * loan.mult10 / 10
		const owner = loan.owner
		if (game.cash[owner] >= owed) {
			game.cash[owner] -= owed
			game.loans.splice(game.loans.indexOf(loan), 1)
			game.log.push(`${log_name(pid)} 打出【挤兑】：${log_name(owner)} 立刻偿付 ${fmt_cash(owed)}。`)
		} else {
			game.loans.splice(game.loans.indexOf(loan), 1)
			eliminate(game, owner, "被【挤兑】无法偿付，破产")
		}
		break
	}
	case "yingzhuolu": {
		const c = city_of(game, tgt.city)
		c.housing = Math.ceil((c.housing * 2) / 3) // 硬着陆：变为 2/3 向上取整
		game.log.push(`${log_name(pid)} 打出【硬着陆】：${c.name} 房价倍数调整为 ${c.housing}。`)
		break
	}
	case "dizhichongzu": {
		// 抵押重组：弃置 2 块土地（手上或消费者池），现金归 0，取消本次破产
		// （在破产前打出，本实现作为普通卡处理：弃 2 地现金归 0）
		let dropped = 0
		for (const h of game.hand[pid].slice()) {
			if (dropped >= 2) break
			if (is_land_card(h)) {
				game.hand[pid].splice(game.hand[pid].indexOf(h), 1)
				game.leftover.push({ kind: "land", value: { base: land_base(h), city: land_city(h) } })
				dropped++
			}
		}
		for (const c of game.cities) {
			if (dropped >= 2) break
			for (const t of c.consumer.slice()) {
				if (dropped >= 2) break
				if (t.owner === pid) {
					c.consumer.splice(c.consumer.indexOf(t), 1)
					game.leftover.push({ kind: "land", value: { base: t.base, city: c.id } })
					dropped++
				}
			}
		}
		if (dropped < 2)
			throw new Error("抵押重组需要弃置 2 块土地")
		game.cash[pid] = 0
		game.log.push(`${log_name(pid)} 打出【抵押重组】：弃置 2 块土地，现金归 0。`)
		break
	}
	case "baojiao": {
		const c = city_of(game, tgt.city)
		for (const p of game.order) {
			if (!game.alive[p])
				continue
			for (const h of game.hand[p].slice()) {
				if (is_land_card(h) && land_city(h) === c.id)
					sell_to_consumer(game, p, h)
			}
			for (const t of c.consumer) {
				if (t.owner === p && !t.paid) {
					if (game.cash[p] >= t.base) {
						game.cash[p] -= t.base
						t.paid = true
						game.log.push(`${log_name(p)} 被【保交楼】强制支付造房费用 ${fmt_cash(t.base)}。`)
					} else {
						// 否则破产
						c.consumer.splice(c.consumer.indexOf(t), 1)
						eliminate(game, p, "被【保交楼】无法支付造房费用，破产")
					}
				}
			}
		}
		game.log.push(`【保交楼】在 ${c.name} 执行完毕。`)
		break
	}
	case "fanfu": {
		const c = city_of(game, tgt.city)
		for (const p of game.order)
			c.bank_rel[p] = 0
		game.log.push(`${log_name(pid)} 打出【金融反腐】：${c.name} 全体银行关系清零。`)
		break
	}
	default:
		game.log.push(`${log_name(pid)} 打出了【${def ? def.name : key}】。`)
	}
}

function sell_to_consumer(game, pid, h) {
	const c = city_of(game, land_city(h))
	const base = land_base(h)
	const proceeds = base * c.housing
	game.hand[pid].splice(game.hand[pid].indexOf(h), 1)
	c.consumer.push({ token: "T" + game.seq++, owner: pid, base, city: c.id, paid: false })
	game.cash[pid] += proceeds
	game.log.push(`${log_name(pid)} 把 ${c.name} 的土地放入消费者池，回收 ${fmt_cash(base)}×${c.housing}=${fmt_cash(proceeds)}。`)
}

// ---------------------------------------------------------------------------
// 卖房阶段
// ---------------------------------------------------------------------------

function sell_start(game) {
	const n = game.order.length
	game.sell = { order: [], i: 0 }
	for (let k = 0; k < n; ++k) {
		const p = game.order[(game.counter * 3 + 1 + k) % n]
		if (game.alive[p])
			game.sell.order.push(p)
	}
	sell_advance(game)
}

function sell_advance(game) {
	const s = game.sell
	while (s.i < s.order.length) {
		const p = s.order[s.i]
		game.active = p
		game.state = "sell"
		return
	}
	game.sell = null
	phase_end(game)
}

// ---------------------------------------------------------------------------
// 阶段与回合收尾
// ---------------------------------------------------------------------------

function phase_end(game) {
	if (game.phase < 4) {
		begin_phase(game)
		return
	}
	if (game.phase < 6 && any_pooled_cards(game)) {
		game.log.push("仍有未拍出的贷款或土地，追加 1 个拍卖阶段。")
		begin_phase(game)
		return
	}
	end_round(game)
}

function end_round(game) {
	game.log.push(`.h2 第 ${game.round} 回合结束`)

	for (const c of game.cities) {
		// 已付造房费的交付房产移除出游戏；未交付的留在消费者池
		for (const t of c.consumer.slice()) {
			if (t.paid) {
				c.consumer.splice(c.consumer.indexOf(t), 1)
				game.log.push(`${c.name}：${log_name(t.owner)} 交付房产，土地移除出游戏。`)
			}
		}
		for (const t of c.consumer) {
			if (game.alive[t.owner]) {
				c.markers[t.owner] += 1
				game.log.push(`${c.name}：${log_name(t.owner)} 有土地未交付房产，维权标记 +1（共 ${c.markers[t.owner]}）。`)
			}
		}
		for (const p of game.order) {
			while (game.alive[p] && c.markers[p] >= 3) {
				c.markers[p] -= 3
				c.gov_rel[p] -= 1
				const took = seize_land(game, c, p)
				game.log.push(`${c.name}：${log_name(p)} 维权标记满 3，政府关系 -1 → ${c.gov_rel[p]}，${took ? "一块土地被收回（下回合重新洗入拍卖）" : "但无可收回的土地"}。`)
			}
		}
	}

	// 逮捕检查：任一城市政府关系 ≤ -2
	for (const p of alive_players(game)) {
		for (const c of game.cities) {
			if (c.gov_rel[p] <= -2) {
				eliminate(game, p, `在 ${c.name} 政府关系跌至 ${c.gov_rel[p]}，被逮捕`)
				break
			}
		}
	}

	end_round_check(game)
}

function end_round_check(game) {
	const survivors = alive_players(game)
	if (survivors.length === 1) {
		exports.finish(game, "win", `唯一存活的 ${log_name(survivors[0])} 获胜（现金 ${fmt_cash(game.cash[survivors[0]])}）。`)
		return
	}
	if (survivors.length === 0) {
		const ranked = ranked_players(game)
		exports.finish(game, "end", `全员出局，现金最高者为 ${ranked.map((p) => log_name(p)).join("、")}。`)
		return
	}
	if (game.round >= 4) {
		finish_game(game)
		return
	}
	begin_round(game)
}

function ranked_players(game) {
	return game.order.slice().sort((a, b) => game.cash[b] - game.cash[a])
}

function finish_game(game) {
	// 终局：强制出售所有土地（按各城当前房价倍数回收现金）
	for (const p of alive_players(game)) {
		for (const h of game.hand[p].slice()) {
			if (!is_land_card(h))
				continue
			const c = city_of(game, land_city(h))
			const proceeds = land_base(h) * c.housing
			game.hand[p].splice(game.hand[p].indexOf(h), 1)
			game.cash[p] += proceeds
			game.log.push(`${log_name(p)} 强制售出 ${c.name} 土地（${fmt_cash(land_base(h))}×${c.housing}=${fmt_cash(proceeds)}）。`)
		}
	}
	const ranked = ranked_players(game)
	const best = Math.max(...alive_players(game).map((p) => game.cash[p]))
	const winners = alive_players(game).filter((p) => game.cash[p] === best)
	game.log.push("")
	game.log.push(`终局排名：${ranked.map((p) => `${log_name(p)} ${fmt_cash(game.cash[p])}`).join("，")}。`)
	exports.finish(game, "win", `胜利者：${winners.map((p) => log_name(p)).join("、")}（${fmt_cash(best)}）。`)
}

// 收回该玩家在该城市价格最高的地块：手上的优先级仅在同价时生效
function seize_land(game, c, pid) {
	let cand = null
	for (const h of game.hand[pid]) {
		if (is_land_card(h) && land_city(h) === c.id)
			if (!cand || land_base(h) > cand.base)
				cand = { src: h, base: land_base(h) }
	}
	for (const t of c.consumer) {
		if (t.owner === pid && !t.paid)
			if (!cand || t.base > cand.base)
				cand = { src: t, base: t.base }
	}
	if (!cand)
		return false
	if (cand.src.token) {
		c.consumer.splice(c.consumer.indexOf(cand.src), 1)
	} else {
		game.hand[pid].splice(game.hand[pid].indexOf(cand.src), 1)
	}
	game.leftover.push({ kind: "land", value: { base: cand.base, city: c.id } })
	return true
}

function eliminate(game, pid, reason) {
	if (!game.alive[pid])
		return
	game.alive[pid] = false
	game.log.push(`*${log_name(pid)} ${reason}！`)
	for (const c of game.cities)
		c.consumer = c.consumer.filter((t) => t.owner !== pid)
	game.loans = game.loans.filter((l) => l.owner !== pid)
	game.hand[pid] = []
}

// ---------------------------------------------------------------------------
// states 状态机
// ---------------------------------------------------------------------------

var states = {}

states.game_over = {}

states.init_pick = {
	inactive: "初设：选城抽地",
	prompt(game, view) {
		view.prompt = `初设：${log_name(game.active)} 请选择一个城市，免费抽取一块土地（该城银行关系+2，城市不得重复）。`
		// 已有人选过的城市不可再选
		var available = game.cities.filter(function (c) { return game.picked.indexOf(c.id) < 0 }).map(function (c) { return c.id })
		view.actions = { choose_city: available }
	},
	choose_city(game, player, arg) {
		if (player !== game.active)
			throw new Error("还没轮到你")
		const c = city_of(game, arg)
		if (!c)
			throw new Error("未知城市")
		if (game.picked.indexOf(c.id) >= 0)
			throw new Error("该城市已被其他玩家选择")
		const land = c.gov.pop()
		if (!land)
			throw new Error("该城市的土地池是空的")
		game.hand[player].push({ uid: land.uid, card: land_card_code(land.base, land.city) })
		c.bank_rel[player] += 2 // 初设抽地：该城银行关系+2
		game.picked.push(c.id)
		game.log.push(`${log_name(player)} 在 ${c.name} 免费抽取了一块土地（银行关系+2）。`)
		if (game.picked.length >= game.order.length) {
			game.picked = []
			begin_first_round_after_setup(game)
		} else {
			game.active = next_player(game, player)
			game.state = "init_pick"
		}
	},
}

states.window = {
	inactive: "拍卖前出牌",
	prompt(game, view) {
		const p = game.active
		view.prompt = `拍卖前的出牌窗口：${log_name(p)} 可打出 1 张牌（每阶段限 1 张），或跳过。`
		view.actions = {
			play_card: playable_cards(game, p).map((h) => h.uid),
			pass_window: 1,
		}
	},
	play_card(game, player, arg) {
		if (player !== game.active)
			throw new Error("不是你的出牌窗口")
		if (has_played_this_phase(game, player))
			throw new Error("每个阶段只能打出 1 张牌")
		const h = game.hand[player].find((x) => x.uid === arg)
		if (!h)
			throw new Error("你没有这张牌")
		const def = CARDS[h.card]
		if (!def)
			throw new Error("未知卡牌")
		if (game.played[arg])
			throw new Error("本阶段你已经打过牌了")
		if (legal_targets(game, def, player) === null)
			throw new Error("这张卡当前没有合法目标")

		consume_card(game, player, arg)

		if (def.targets.length === 0) {
			apply_card(game, player, h, {})
			window_stay(game, player)
			return
		}
		game.pending = { type: "card", card: h.card, got: {}, left: def.targets.slice(), def_targets: def.targets.slice() }
		route_targets(game, player)
	},
	pass_window(game, player) {
		if (player !== game.active)
			throw new Error("不是你的出牌窗口")
		window_finish_player(game)
	},
}

function window_stay(game, player) {
	// 出完牌后窗口自动推进到下家（无需再点跳过）
	window_finish_player(game)
}

function route_targets(game, player) {
	const pend = game.pending
	if (pend.left.length === 0) {
		const h = { uid: pend.uid, card: pend.card }
		game.pending = null
		apply_card(game, player, h, pend.got)
		window_stay(game, player)
		return
	}
	const t = pend.left[0]
	game.state = { city: "card_city", player: "card_player", handland: "card_land", ownloan: "card_loan", rot: "card_rot", anyloan: "card_loan" }[t]
	if (!game.state)
		throw new Error("未知目标类型 " + t)
	game.active = player
}

states.card_city = {
	inactive: "选择目标城市",
	prompt(game, view) {
		const pend = game.pending
		view.prompt = `【${CARDS[pend.card].name}】请选择一个城市。`
		const lt = legal_targets(game, CARDS[pend.card], game.active)
		view.actions = { choose_card_city: (lt && lt.cities) || game.cities.map((c) => c.id) }
	},
	choose_card_city(game, player, arg) {
		const pend = game.pending
		if (player !== game.active)
			throw new Error("不是你的选择")
		const lt = legal_targets(game, CARDS[pend.card], player)
		if (!lt || !lt.cities || lt.cities.indexOf(arg) < 0)
			throw new Error("无效的目标城市")
		pend.got.city = arg
		pend.left.shift()
		route_targets(game, player)
	},
}

states.card_player = {
	inactive: "选择目标玩家",
	prompt(game, view) {
		const pend = game.pending
		view.prompt = `【${CARDS[pend.card].name}】请选择一名对手。`
		view.actions = { choose_card_player: other_alive(game, game.active) }
	},
	choose_card_player(game, player, arg) {
		const pend = game.pending
		if (player !== game.active)
			throw new Error("不是你的选择")
		if (other_alive(game, player).indexOf(arg) < 0)
			throw new Error("无效的目标玩家")
		pend.got.player = arg
		pend.left.shift()
		route_targets(game, player)
	},
}

states.card_land = {
	inactive: "选择自己的土地",
	prompt(game, view) {
		const pend = game.pending
		view.prompt = `【${CARDS[pend.card].name}】请选择你手上的一块土地。`
		view.actions = { choose_card_land: game.hand[game.active].filter(is_land_card).map((h) => h.uid) }
	},
	choose_card_land(game, player, arg) {
		const pend = game.pending
		if (player !== game.active)
			throw new Error("不是你的选择")
		if (!game.hand[player].some((h) => h.uid === arg && is_land_card(h)))
			throw new Error("你没有这块土地")
		pend.got.land = arg
		pend.left.shift()
		route_targets(game, player)
	},
}

states.card_loan = {
	inactive: "选择贷款",
	prompt(game, view) {
		const pend = game.pending
		const mine = pend.def_targets && pend.def_targets.includes("anyloan")
		view.prompt = `【${CARDS[pend.card].name}】请选择${mine ? "一笔" : "你自己的一笔"}贷款。`
		view.actions = { choose_card_loan: (mine
			? game.loans.filter((l) => game.alive[l.owner])
			: game.loans.filter((l) => l.owner === game.active)).map((l) => l.uid) }
	},
	choose_card_loan(game, player, arg) {
		const pend = game.pending
		if (player !== game.active)
			throw new Error("不是你的选择")
		const mine = pend.def_targets && pend.def_targets.includes("anyloan")
		if (!game.loans.some((l) => l.uid === arg && (mine ? game.alive[l.owner] : l.owner === player)))
			throw new Error("那不是可选的贷款")
		pend.got.loan = arg
		pend.left.shift()
		route_targets(game, player)
	},
}

states.card_rot = {
	inactive: "旋转门：选择方向与城市",
	prompt(game, view) {
		const lt = legal_targets(game, CARDS.xuanzhuan, game.active)
		view.prompt = "【旋转门】点击目标城市：政→银（政府-1、银行+2）或 银→政（银行-1、政府+2）。"
		view.actions = {}
		if (lt.rot_bank && lt.rot_bank.length)
			view.actions.rot_to_bank = lt.rot_bank
		if (lt.rot_gov && lt.rot_gov.length)
			view.actions.rot_to_gov = lt.rot_gov
	},
	rot_to_bank(game, player, arg) {
		do_rot(game, player, arg, "to_bank")
	},
	rot_to_gov(game, player, arg) {
		do_rot(game, player, arg, "to_gov")
	},
}

function do_rot(game, player, cid, dir) {
	if (player !== game.active)
		throw new Error("不是你的选择")
	const c = city_of(game, cid)
	if (!c)
		throw new Error("未知城市")
	if (dir === "to_bank" && c.gov_rel[player] < 1)
		throw new Error("政府关系不足")
	if (dir === "to_gov" && c.bank_rel[player] < 1)
		throw new Error("银行关系不足")
	const pend = game.pending
	game.pending = null
	apply_card(game, player, { uid: pend.uid, card: pend.card }, { city: cid, dir })
	window_stay(game, player)
}

states.transfer = {
	inactive: "决定是否转贷",
	prompt(game, view) {
		const loan = game.loans.find((l) => l.uid === game.pending.uid)
		const c = city_of(game, loan.city)
		view.prompt = `转贷机会：可将刚拍得的 ${fmt_cash(loan.principal)} 的一半/全部支付给 ${c.name} 政府（政府关系 +1/+2），贷款仍由你偿还。`
		const acts = { transfer_no: 1 }
		if (game.cash[game.active] >= loan.principal / 2)
			acts.transfer_half = 1
		if (game.cash[game.active] >= loan.principal)
			acts.transfer_all = 1
		view.actions = acts
	},
	transfer_half(game, player) {
		do_transfer(game, player, 1)
	},
	transfer_all(game, player) {
		do_transfer(game, player, 2)
	},
	transfer_no(game, player) {
		if (player !== game.active)
			throw new Error("还没轮到你")
		game.pending = null
		run_auctions(game)
	},
}

function do_transfer(game, player, level) {
	if (player !== game.active)
		throw new Error("还没轮到你")
	const loan = game.loans.find((l) => l.uid === game.pending.uid)
	const pay = level === 2 ? loan.principal : Math.floor(loan.principal / 2)
	if (game.cash[player] < pay)
		throw new Error("现金不足")
	const c = city_of(game, loan.city)
	game.cash[player] -= pay
	c.gov_rel[player] += level
	game.pending = null
	game.log.push(`${log_name(player)} 转贷给 ${c.name} 政府 ${fmt_cash(pay)}，政府关系 +${level} → ${c.gov_rel[player]}。`)
	run_auctions(game)
}

states.bid = {
	inactive: "竞拍",
	prompt(game, view) {
		const bid = game.bid
		const c = city_of(game, bid.city)
		if (bid.kind === "loan") {
			view.prompt = `竞拍 ${c.name} 的贷款 ${fmt_cash(bid.principal)}：偿还倍数 1.5 起拍、步进 0.5、封顶 5 倍。当前最高：${bid.high ? log_name(bid.high) + " " + fmt_mult(bid.mult) : "无"}。`
			const opts = []
			const lo = bid.high === null ? 15 : bid.mult + 5
			for (let m = lo; m <= 50; m += 5)
				opts.push(m)
			view.actions = { loan_bid: opts, bid_pass: 1 }
		} else {
			view.prompt = `竞拍 ${c.name} 的土地（底价 ${fmt_cash(bid.land.base)}）：倍数 2 起拍、步进 1、封顶 10 倍。当前最高：${bid.high ? log_name(bid.high) + " " + bid.mult + " 倍" : "无"}。`
			const opts = []
			const lo = bid.high === null ? 2 : bid.mult + 1
			for (let m = lo; m <= 10; ++m)
				if (bid.land.base * m <= game.cash[game.active])
					opts.push(m)
			view.actions = { land_bid: opts, bid_pass: 1 }
		}
	},
	loan_bid(game, player, arg) {
		bid_action(game, player, arg, 15, 50, 5)
	},
	land_bid(game, player, arg) {
		bid_action(game, player, arg, 2, 10, 1)
	},
	bid_pass(game, player) {
		if (player !== game.active)
			throw new Error("还没轮到你")
		game.bid.passed.push(player)
		game.log.push(`${log_name(player)} 弃拍。`)
		close_or_continue(game)
	},
}

function bid_action(game, player, arg, lo, hi, step) {
	if (player !== game.active)
		throw new Error("还没轮到你")
	const bid = game.bid
	const v = Number(arg)
	if (!Number.isInteger(v) || v < lo || v > hi || (v - lo) % step !== 0)
		throw new Error("非法报价")
	if (bid.high !== null && v <= bid.mult)
		throw new Error("必须高于当前最高价")
	// 土地竞拍需要真金白银：出价倍数 × 底价不得超过现金
	if (bid.kind === "land" && bid.land.base * v > game.cash[player])
		throw new Error("现金不足，买不起这个倍数")
	bid.high = player
	bid.mult = v
	game.bid_history.push([player, v]) // 记录出价历史
	game.log.push(`${log_name(player)} 报价 ${bid.kind === "loan" ? fmt_mult(v) + " 倍" : v + " 倍"}。`)
	close_or_continue(game)
}

states.sell = {
	inactive: "卖房",
	prompt(game, view) {
		const p = game.active
		const my_lands = game.hand[p].filter(is_land_card)
		const my_tokens = []
		for (const c of game.cities)
			for (const t of c.consumer)
				if (t.owner === p && !t.paid && game.cash[p] >= t.base)
					my_tokens.push(t.token)
		view.prompt = `卖房阶段：手上土地放入消费者池可换取 底价×房价倍数 的现金；也可为池中的土地支付造房费用（回合结束时交付）。不卖房最多持有 ${MAX_HOLD_LAND} 块（超出请在后续卖房阶段消化）。`
		view.actions = {
			sell_land: my_lands.map((h) => h.uid),
			develop_land: my_tokens,
			sell_end: 1,
		}
	},
	sell_land(game, player, arg) {
		const h = game.hand[player].find((x) => x.uid === arg && is_land_card(x))
		if (!h)
			throw new Error("没有这块土地")
		sell_to_consumer(game, player, h)
	},
	develop_land(game, player, arg) {
		for (const c of game.cities) {
			const t = c.consumer.find((x) => x.token === arg && x.owner === player && !x.paid)
			if (t) {
				if (game.cash[player] < t.base)
					throw new Error("现金不足以支付造房费用")
				game.cash[player] -= t.base
				t.paid = true
				game.log.push(`${log_name(player)} 为 ${c.name} 的土地支付造房费用 ${fmt_cash(t.base)}，回合结束时交付房产。`)
				return
			}
		}
		throw new Error("找不到这块土地")
	},
	sell_end(game, player) {
		if (player !== game.active)
			throw new Error("还没轮到你")
		game.sell.i++
		sell_advance(game)
	},
}

// ---------------------------------------------------------------------------
// action 入口
// ---------------------------------------------------------------------------

exports.finish = function (state, result, message) {
	state.state = "game_over"
	state.active = "None"
	state.result = result
	state.victory = message
	state.bid = null
	state.aq = null
	state.pending = null
	state.window = null
	state.sell = null
	state.log.push("")
	state.log.push(message)
	return state
}

exports.action = function (state, player, action, arg) {
	var game = state
	if (game.state === "game_over")
		return game

	const S = states[game.state]
	if (S && typeof S[action] === "function") {
		S[action](game, player, arg)
		return game
	}
	throw new Error(`Invalid action: ${action} in state ${game.state}`)
}

function public_hand(game, pid) {
	return game.hand[pid].map((h) => {
		if (is_land_card(h))
			return { uid: h.uid, kind: "land", base: land_base(h), city: land_city(h), label: `土地·${fmt_cash(land_base(h))}` }
		const def = CARDS[h.card]
		return {
			uid: h.uid, kind: "card", card: h.card, label: def ? def.name : h.card,
			desc: def ? def.desc : "", news: def ? def.news : "",
		}
	})
}

function role_name_safe(game, pid) {
	return ROLE_NAMES[pid] || pid
}

exports.view = function (state, player) {
	var game = state

	const view = {
		title: "friends-wine",
		state: game.state,
		active: game.active,
		round: game.round,
		phase: game.phase,
		turn: game.round,
		prompt: "",
		log: game.log,
		actions: null,
		players: game.order.map((p) => ({
			id: p,
			name: ROLE_NAMES[p],
			cash: game.cash[p],
			alive: game.alive[p],
		})),
		cities: game.cities.map((c) => ({
			id: c.id,
			name: c.name,
			housing: c.housing,
			banks_left: c.bank.length,
			govs_left: c.gov.length,
			gov_rel: Object.assign({}, c.gov_rel),
			bank_rel: Object.assign({}, c.bank_rel),
			consumer: c.consumer.map((t) => ({ token: t.token, owner: t.owner, base: t.base, paid: t.paid })),
			markers: Object.assign({}, c.markers),
		})),
		loans: game.loans.map((l) => ({
			uid: l.uid, owner: l.owner, city: l.city, principal: l.principal, mult10: l.mult10, due: l.due,
		})),
		hand_sizes: {},
		// 手牌（不含地块）只对自己可见；地块与贷款公开（另设 lands 字段）
		hands: {},
		lands: {},
		counter: game.counter,
		pending: game.pending ? { type: game.pending.type, card: game.pending.card || null } : null,
		auction_left: game.aq && game.aq.list ? game.aq.list.slice(game.aq.idx + 1).map((e) => ({
			kind: e.kind,
			city: e.city,
			text: e.kind === "loan" ? `贷款 ${fmt_cash(e.principal)}` : `土地 底价 ${fmt_cash(e.land.base)}`,
			priority: !!e.priority,
		})) : [],
		result: game.result,
		victory: game.victory,
	}

	for (const p of game.order) {
		view.hand_sizes[p] = game.hand[p].length
		// 手牌卡（不含地块）仅本人可见；地块公开给所有人
		const full = public_hand(game, p)
		view.hands[p] = p === player ? full.filter(function (h) { return h.kind !== "land" }) : null
		view.lands[p] = full.filter(function (h) { return h.kind === "land" })
	}

	if (game.state === "game_over") {
		view.prompt = game.victory || "游戏结束"
		return view
	}

	const me_alive = game.alive[player]
	const S = states[game.state]

	if (me_alive && game.active === player && S && S.prompt) {
		S.prompt(game, view)
		if (game.state === "window" || game.state === "sell")
			view.my_hand = public_hand(game, player)
	} else if (player !== "Observer" && !(player in game.alive)) {
		view.prompt = "观战中……"
	} else if (!me_alive) {
		view.prompt = `你已出局。等待 ${role_name_safe(game, game.active)} 行动……`
	} else {
		view.prompt = `等待 ${role_name_safe(game, game.active)} 行动……`
	}

	// 给所有人显示当前竞价的公开信息
	if (game.bid) {
		const bid = game.bid
		view.bid_public = {
			kind: bid.kind,
			city: bid.city,
			amount: bid.kind === "loan" ? bid.principal : bid.land.base,
			high: bid.high,
			mult: bid.mult,
			passed: bid.passed.slice(),
			history: (game.bid_history || []).slice(), // 出价历史 [ [玩家, 倍数], ... ]
		}
	}
	return view
}
