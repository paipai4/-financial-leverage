"use strict"

// 朋友的酒 - 规则引擎测试
//   node test_friends_wine.js            全量：确定性小样 + 多种子随机压测
//   node test_friends_wine.js quick      只跑快速集

var r = require("./rules.js")

var failures = 0

function assert(cond, msg) {
	if (!cond) {
		failures++
		console.error("FAIL:", msg)
	}
}

function pick(arr, rnd) {
	return arr[Math.floor(rnd() * arr.length)]
}

function mulberry(seed) {
	let a = seed | 0
	return function () {
		a |= 0
		a = (a + 0x6D2B79F5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// 随机驱动一局直到结束或步数耗尽；every_round_trip 控制多少步做一次 JSON 往返
function fuzz_game(seed, nplayers, max_steps, roundtrip_every, verbose) {
	var scenario, opts = {}
	if (typeof nplayers === "object") {
		opts = nplayers.opts          // { players: N } —— 走创建页自定义座位路径
		scenario = nplayers.scenario || { 2: "双人局", 3: "三人局", 4: "四人局" }[nplayers.n] || "标准局"
		nplayers = nplayers.n
	} else {
		scenario = { 2: "双人局", 3: "三人局", 4: "四人局" }[nplayers] || "标准局" // 旧剧本名兼容路径
	}
	var roles = typeof r.roles === "function" ? r.roles(scenario, opts) : r.roles
	var g = r.setup(seed, scenario, opts)
	var rnd = mulberry(seed * 7919 + nplayers)

	assert(roles.length === nplayers, `seed=${seed} roles 数量 ${roles.length} != ${nplayers}`)
	assert(g.cities.length === nplayers + 1, `seed=${seed} 城市数错误`)

	var steps = 0
	var last_error = null
	while (g.state !== "game_over" && steps < max_steps) {
		steps++

		// view 幂等性
		var viewer = roles[steps % roles.length]
		var v1 = JSON.stringify(r.view(g, viewer))
		r.view(g, viewer)
		var v2 = JSON.stringify(r.view(g, viewer))
		if (v1 !== v2) {
			last_error = `view 不幂等 seed=${seed} step=${steps}`
			break
		}

		// game 必须可序列化
		try {
			g = JSON.parse(JSON.stringify(g))
		} catch (e) {
			last_error = `JSON 往返失败 seed=${seed} step=${steps}: ${e.message}`
			break
		}

		// 当前决策者视角的可用动作里随机挑一个
		var me = g.active
		var myv = r.view(g, me)
		var acts = myv.actions
		if (!acts || Object.keys(acts).length === 0) {
			last_error = `状态 ${g.state} 无可用动作（active=${me}）`
			break
		}
		var names = []
		for (var k in acts) {
			var v = acts[k]
			if (!v || (Array.isArray(v) && v.length === 0))
				continue // 空数组动作不可选
			names.push(k)
		}
		if (names.length === 0) {
			last_error = `状态 ${g.state} 动作列表全为空（active=${me}）`
			break
		}
		var aname = pick(names, rnd)
		var aval = acts[aname]
		var arg = null
		if (Array.isArray(aval))
			arg = pick(aval, rnd)
		else if (aval === 1)
			arg = null

		try {
			r.action(g, me, aname, arg)
		} catch (e) {
			last_error = `动作失败 seed=${seed} step=${steps} ${g.state}.${aname}(${JSON.stringify(arg)}): ${e.message}`
			break
		}

		if (verbose && steps <= 40)
			console.log(`  [${steps}] ${g.state} <- ${me}.${aname}(${JSON.stringify(arg)})`)
	}

	if (last_error) {
		failures++
		console.error(last_error)
		return false
	}

	if (g.state !== "game_over") {
		failures++
		console.error(`FAIL: seed=${seed} ${nplayers}p 在 ${max_steps} 步内未终局（卡在 ${g.state}）`)
		return false
	}

	assert(typeof g.victory === "string" && g.victory.length > 0, `seed=${seed} 缺少胜利描述`)
	return true
}

// ---------------------------------------------------------------------------
// 确定性小样：基本结构 + 初始抽地流转
// ---------------------------------------------------------------------------

function basic_checks() {
	var g = r.setup("t1", "标准局", { players: 5 })
	assert(g.cities.length === 6, "options.players=5 应有 6 座城市")
	assert(g.order.length === 5, "options.players=5 应有 5 位玩家")

	g = r.setup("t1", "双人局") // 旧剧本名兼容
	assert(g.cities.length === 3 && g.order.length === 2, "旧剧本名 双人局 兼容")

	// 非本回合玩家操作应报错
	var threw = false
	try {
		r.action(g, "Li", "choose_city", g.cities[0].id)
	} catch (e) {
		threw = true
	}
	assert(threw, "非行动方选城必须被拒绝")

	// options 为 JSON 字符串时也能解析（模拟 DB 往返）
	g = r.setup("t1", "标准局", '{"players":4}')
	assert(g.order.length === 4, "字符串 options.players=4 解析")

	// 非法值回退默认 2 人；越界裁剪到 6
	assert(r.roles("标准局", {}).length === 2, "无 players 默认 2 人")
	assert(r.roles("标准局", { players: "99" }).length === 6, "越界 players 裁剪到上限")
	assert(r.roles("标准局", { players: "1" }).length === 2, "下限 players 抬到 2")

	assert(r.default_scenario === "标准局", "默认剧本 标准局")

	// view 对 Observer 不泄漏手牌
	var vo = r.view(r.setup("t1", "标准局"), "Observer")
	assert(vo.actions === null, "Observer 没有动作")
	assert(!("my_hand" in vo), "Observer 视图不应有手牌字段")

	console.log("basic_checks 完成")
}

// ---------------------------------------------------------------------------
// 随机压测
// ---------------------------------------------------------------------------

function main() {
	var quick = process.argv.indexOf("quick") >= 0
	basic_checks()

	var seeds = quick ? [1, 2] : [1, 2, 3, 4, 5, 42]
	var configs = [
		{ n: 2 },                                     // 旧剧本名路径
		{ n: 3 }, { n: 4 },
		{ n: 2, scenario: "标准局", opts: { players: "2" } },   // 创建页自定义座位（字符串来自表单）
		{ n: 4, scenario: "标准局", opts: { players: "4" } },
		{ n: 5, scenario: "标准局", opts: { players: "5" } },
		{ n: 6, scenario: "标准局", opts: { players: "6" } },
	]
	for (const s of seeds) {
		for (const cfg of configs) {
			var ok = fuzz_game(s, cfg, 4000, 50, false)
			if (ok)
				console.log(`PASS seed=${s} ${cfg.n}人局${cfg.opts ? "(options.players)" : ""}`)
		}
	}

	console.log(failures === 0 ? "\n全部测试通过 ✅" : `\n有 ${failures} 处失败 ❌`)
	process.exit(failures === 0 ? 0 : 1)
}

main()
