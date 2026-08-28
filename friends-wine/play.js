"use strict"

/**
 * 朋友的酒 - 前端渲染
 * 依赖 /common/client.js（send_action/on_update/action_button）与 data.js（FW 常量）
 *
 * 交互原则（按用户意见修订）：
 *   - 绝大多数操作点在地图上：城市列（选城）、手牌卡（打牌/卖地）、
 *     侧栏座位卡（选目标玩家）、消费者池地块（支付造房费），可点目标统一橙金高亮
 *   - 顶部 #actions 只保留“确认/跳过”型动作：跳过出牌、转贷三选、结束卖房
 *   - 每一次竞拍都弹出模态窗口，谁的回合谁在窗口里叫价/弃拍
 */

var myRole = null
var FW_CITY_BG_OPACITY = 40 // 城市底图透明度（0-100）

function A(name) {
	return (view && view.actions && view.actions[name]) || null
}

function can(name, arg) {
	var a = A(name)
	if (!a)
		return false
	if (Array.isArray(a))
		return a.indexOf(arg) >= 0
	return true
}

// ---------- 初始化 ----------

function on_init(scenario, options, static_view) {
	myRole = params.role
}

// ---------- 结构化日志（分类着色：金额/玩家/城市/事件/回合） ----------
// 服务端日志约定：".h1 " 回合标题、".h2 " 阶段标题、"*" 加粗事件；
// 其余行按内容启发式分类着色

var FW_CITY_NAMES = ["东江", "南湾", "西岭", "北原", "中州", "云溪", "沧澜"]

function on_log(text) {
	var p = document.createElement("div")
	var cls = ""
	if (text.startsWith(".h1 ")) {
		text = text.substring(4)
		cls = "h1"
	} else if (text.startsWith(".h2 ")) {
		text = text.substring(4)
		cls = "h2"
	} else if (text.startsWith("*")) {
		text = text.substring(1)
		cls = "bold"
	} else if (text === "")
		cls = ""
	else
		cls = log_classify(text)
	p.className = cls
	p.textContent = text
	return p
}

function log_classify(text) {
	// 金额（含 万/亿 或 ×倍数）
	if (/[0-9]+(\.\d+)?(万|亿)/.test(text) || /×/.test(text))
		return "fw-money"
	// 玩家动作/点名（含任何企业名）
	for (const rn of ["旺达", "龙创", "久大", "旺柯", "币贵", "格陵兰"])
		if (text.indexOf(rn) >= 0)
			return "fw-player"
	// 城市相关（翻出/流拍/房价/政府/银行关系）
	for (const cn of FW_CITY_NAMES)
		if (text.indexOf(cn) >= 0)
			return "fw-city"
	// 事件/系统（开局、转贷、展期等）
	return "fw-event"
}

// ---------- 更新 ----------

function on_update() {
	if (typeof view !== "object" || !view)
		return
	render_action_buttons()
	render_auction_dialog()
	render_stage()
	render_cities()
	render_players()
	render_sidebar()
}

// ---------- 顶部按钮（只留确认/跳过型动作） ----------

function render_action_buttons() {
	var acts = view.actions || {}
	var defs = [
		["pass_window", "跳过出牌"],
		["transfer_half", "转一半（本地+1）"],
		["transfer_all", "全部转贷（本地+2）"],
		["transfer_no", "放弃转贷"],
		["sell_end", "结束卖房"],
	]
	for (const [name, label] of defs)
		if (name in acts)
			action_button(name, label)
}

// ---------- 竞拍弹窗 ----------

function render_auction_dialog() {
	var dlg = document.getElementById("auction_dialog")
	var body = document.getElementById("auction_body")
	var bid = view.bid_public || null

	if (!bid) {
		if (dlg.open)
			dlg.close()
		return
	}

	body.replaceChildren()

	var title = document.createElement("h3")
	title.textContent = `${city_name(bid.city)} · ${bid.kind === "loan" ? "贷款竞拍" : "土地竞拍"}`
	body.appendChild(title)

	// 拖动弹窗：按住标题栏拖动（仿上海1937 的 chart_popup）
	make_draggable(dlg, title)

	var inner = document.createElement("div")
	inner.className = "body"
	var lines = []
	lines.push(`拍品：${bid.kind === "loan" ? "贷款" : "土地"} ${fw_fmt_cash(bid.amount)}`)

	// 当前出价方：醒目大字
	var cur = document.createElement("div")
	cur.className = "bid-current"
	if (bid.high) {
		cur.innerHTML = `当前出价：<b style="color:${fw_color(bid.high)}">${who_name(bid.high)}</b> ` +
			`<b>${bid.kind === "loan" ? fmt_mult10(bid.mult) + " 倍" : bid.mult + " 倍"}</b>`
	} else {
		cur.innerHTML = "当前出价：<b>暂无报价，等待起拍……</b>"
	}
	inner.appendChild(cur)

	if (bid.kind === "loan")
		lines.push("中标后领取本金；到期按中标倍数还本付息。")
	else
		lines.push(`房价倍数 ${city_by_id(bid.city).housing}：出价倍数为最终成交倍率。`)
	if (bid.passed && bid.passed.length)
		lines.push(`已弃拍：${bid.passed.map(function (p) { return who_name(p) }).join("、")}`)

	var txt = document.createElement("div")
	txt.style.whiteSpace = "pre-line"
	txt.textContent = lines.join("\n")
	inner.appendChild(txt)

	// 出价历史：倒序显示最近报价
	if (bid.history && bid.history.length > 0) {
		var hist = document.createElement("div")
		hist.className = "bid-history"
		var hlab = document.createElement("div")
		hlab.className = "bid-history-label"
		hlab.textContent = "出价历史"
		hist.appendChild(hlab)
		var hlist = bid.history.slice().reverse()
		for (const [pid, m] of hlist) {
			var hrow = document.createElement("div")
			hrow.className = "bid-history-row"
			hrow.innerHTML = `<span style="color:${fw_color(pid)}">● ${who_name(pid)}</span> ` +
				`<b>${bid.kind === "loan" ? fmt_mult10(m) + " 倍" : m + " 倍"}</b>` +
				(m === bid.mult && pid === bid.high ? " <em>（当前最高）</em>" : "")
			hist.appendChild(hrow)
		}
		inner.appendChild(hist)
	}

	// 操作按钮：仅当前可用的动作（view.actions 驱动）
	var grid = document.createElement("div")
	grid.className = "bid-grid"
	var mine = my_turn()
	if (mine) {
		if (Array.isArray(A("loan_bid")))
			for (const v of A("loan_bid"))
				grid.appendChild(dialog_btn("×" + fmt_mult10(v), function () { send_action("loan_bid", v) }))
		if (Array.isArray(A("land_bid")))
			for (const v of A("land_bid"))
				grid.appendChild(dialog_btn(v + " 倍", function () { send_action("land_bid", v) }))
		if (can("bid_pass"))
			grid.appendChild(dialog_btn("弃拍", function () { send_action("bid_pass") }, "warn"))
	} else {
		var wait = document.createElement("span")
		wait.className = "btn"
		wait.textContent = `等待 ${who_name(view.active)} 报价……`
		grid.appendChild(wait)
	}
	inner.appendChild(grid)
	body.appendChild(inner)

	if (!dlg.open)
		dlg.showModal()
}

function dialog_btn(label, fn, cls) {
	var b = document.createElement("button")
	b.className = cls || ""
	b.textContent = label
	b.addEventListener("click", fn)
	return b
}

// 弹窗拖动：按住标题栏移动（仿上海1937 chart_popup）
function make_draggable(dlg, handle) {
	var startX = 0, startY = 0, ox = 0, oy = 0
	handle.addEventListener("mousedown", function (evt) {
		if (evt.button !== 0)
			return
		startX = evt.clientX
		startY = evt.clientY
		ox = dlg.offsetLeft
		oy = dlg.offsetTop
		function onMove(e) {
			dlg.style.left = (ox + e.clientX - startX) + "px"
			dlg.style.top = (oy + e.clientY - startY) + "px"
		}
		function onUp() {
			document.removeEventListener("mousemove", onMove)
			document.removeEventListener("mouseup", onUp)
		}
		document.addEventListener("mousemove", onMove)
		document.addEventListener("mouseup", onUp)
		evt.preventDefault()
	})
}

// ---------- 信息面板（拍卖台当拍品描述，附带排队预览） ----------

function render_stage() {
	var el = document.getElementById("stage")
	el.replaceChildren()
	if (view.state === "game_over") {
		el.appendChild(make_panel("终局", String(view.prompt)))
		return
	}

	// 城市底图透明度控制条
	var opBar = document.createElement("div")
	opBar.className = "opacity-bar"
	var opLab = document.createElement("span")
	opLab.textContent = "城市底图透明度"
	opBar.appendChild(opLab)
	var opInput = document.createElement("input")
	opInput.type = "range"
	opInput.min = "0"
	opInput.max = "100"
	opInput.value = String(FW_CITY_BG_OPACITY || 40)
	opInput.addEventListener("input", function () {
		FW_CITY_BG_OPACITY = Number(opInput.value)
		document.documentElement.style.setProperty("--city-bg-opacity", (FW_CITY_BG_OPACITY / 100).toFixed(2))
	})
	opBar.appendChild(opInput)
	el.appendChild(opBar)

	// 还款提醒条：常驻显示每笔未偿贷款离到期的阶段数，最紧急的醒目
	var loans = (view.loans || []).filter(function (l) { return l.owner && (view.players || []).some(function (p) { return p.id === l.owner && p.alive }) })
	if (loans.length > 0) {
		var bar = document.createElement("div")
		bar.className = "due-bar"
		var barTitle = document.createElement("span")
		barTitle.className = "due-bar-title"
		barTitle.textContent = "⏰ 还款提醒"
		bar.appendChild(barTitle)
		loans.sort(function (a, b) { return a.due - b.due })
		for (const l of loans) {
			var dueIn = (l.due || 0) - (view.counter || 0)
			var urgent = dueIn <= 0
			var soon = dueIn > 0 && dueIn <= 2
			var chip = document.createElement("span")
			chip.className = "due-chip" + (urgent ? " due-now" : soon ? " due-soon" : "")
			chip.textContent = `${who_name(l.owner)} ${city_name(l.city)} ${fw_fmt_cash(l.principal)}×${fmt_mult10(l.mult10)}：${urgent ? "立即还！" : dueIn + " 阶段后"}`
			bind_tooltip(chip, `贷款 ${fw_fmt_cash(l.principal)} · 偿还倍数 ${fmt_mult10(l.mult10)} · 到期阶段 ${l.due}（当前第 ${view.counter} 阶段）`, "loan")
			bar.appendChild(chip)
		}
		el.appendChild(bar)
	}

	// 竞价详情在弹窗里；这里只保留待拍队列预览
	if (view.auction_left && view.auction_left.length > 0) {
		var qtxt = view.auction_left.map(function (e) {
			return city_name(e.city) + "·" + e.text + (e.priority ? "(优先权)" : "")
		}).join("  →  ")
		el.appendChild(make_panel("本阶段剩余拍品", qtxt))
	}
}

// ---------- 城市列（可点目标） ----------

function render_cities() {
	var box = document.getElementById("cities")
	box.replaceChildren()
	for (const c of (view.cities || []))
		box.appendChild(render_city(c))
}

// 当前可被“选城”类动作选中的城市 id 集合
function city_targets() {
	var ids = []
	var k1 = A("choose_city")
	var k2 = A("choose_card_city")
	if (Array.isArray(k1)) ids = ids.concat(k1)
	if (Array.isArray(k2)) ids = ids.concat(k2)
	if (can("rot_to_bank") || can("rot_to_gov")) {
		if (Array.isArray(A("rot_to_bank"))) ids = ids.concat(A("rot_to_bank"))
		if (Array.isArray(A("rot_to_gov"))) ids = ids.concat(A("rot_to_gov"))
	}
	return ids
}

function render_city(c) {
	var root = document.createElement("div")
	root.className = "city"

	// 城市底图（images/cityN.jpg），透明度可调（全局滑块）
	var idx = Number(c.id.replace(/\D/g, "")) || 1
	var img = document.createElement("img")
	img.className = "city-bg"
	img.src = `images/city${Math.min(idx, 9)}.jpg`
	img.draggable = false
	root.appendChild(img)

	var head = document.createElement("div")
	head.className = "cname"
	head.textContent = c.name
	root.appendChild(head)

	var hbtn = document.createElement("div")
	hbtn.className = "housing"
	hbtn.textContent = "×" + c.housing
	bind_tooltip(hbtn,
		`${c.name} 房价倍数：${c.housing}\n` +
		"每成交一块土地 +1；≥4倍成交额外 +1；≥8倍再额外 +1\n" +
		"消费者回收现金 = 底价 × 该倍数；造房费用 = 底价",
		"city")
	root.appendChild(hbtn)

	root.appendChild(pool_block("银行池", c.banks_left, false,
		`每回合 4 笔贷款，正面朝下堆叠\n每阶段翻出最上面 1 笔进入竞拍（1.5~5倍偿还）\n剩余 ${c.banks_left} 笔未翻`))
	root.appendChild(pool_block("土地出让池", c.govs_left, true,
		`每回合 4 块土地，正面朝下堆叠\n每阶段翻出最上面 1 块进入竞拍（2~10倍底价）\n剩余 ${c.govs_left} 块未翻`))

	var rels = document.createElement("div")
	rels.className = "rels"
	rels.appendChild(rel_row(c, "gov_rel", "政"))
	rels.appendChild(rel_row(c, "bank_rel", "银"))
	root.appendChild(rels)

	// 消费者池：始终显示（含空态），带标题区块
	var con = c.consumer || []
	var clist = document.createElement("div")
	clist.className = "consumer-block"
	var clab = document.createElement("div")
	clab.className = "cblabel"
	clab.textContent = `消费者池${con.length ? "" : "（空）"}`
	clist.appendChild(clab)
	var tokens = document.createElement("div")
	tokens.className = "consumer-list"
	if (con.length === 0 && !Object.keys(c.markers || {}).some(function (k) { return c.markers[k] > 0 })) {
		var empty = document.createElement("span")
		empty.className = "consumer-empty"
		empty.textContent = "暂无地块——可把手上土地放进来换现金，或支付造房费交付房产。"
		tokens.appendChild(empty)
	}
	for (const tok of con) {
		var t = document.createElement("span")
		t.className = "token" + (tok.paid ? " paid" : "")
		t.style.borderColor = fw_color(tok.owner)
		t.textContent = `${FW.ROLE_BADGES[tok.owner] || "?"}${tok.base}万${tok.paid ? "✓" : ""}`
		bind_tooltip(t,
			`${who_name(tok.owner)} 的地块 · 底价 ${fw_fmt_cash(tok.base)}\n` +
			(tok.paid ? "已支付造房费用，回合结束时交付房产" : "未交付：回合结束获得 1 个维权标记") +
			"\n每 3 个维权标记：本地关系-1 并收回一块地",
			"land")
		// 支付造房费：绿框可点
		if (!tok.paid && can("develop_land", tok.token)) {
			t.classList.add("developable")
			t.addEventListener("click", function () { send_action("develop_land", tok.token) })
		}
		// 该玩家在本城的维权标记：直接标在土地旁边（玩家色）
		var mkv = (c.markers || {})[tok.owner] || 0
		if (mkv > 0) {
			var mk = document.createElement("span")
			mk.className = "marker-chip"
			mk.style.background = fw_color(tok.owner)
			mk.textContent = `⚖${mkv}`
			bind_tooltip(mk, `${who_name(tok.owner)} 在本城的维权标记：${mkv} 个（每 3 个本地关系-1 并收回一块地）`, "rel")
			t.appendChild(mk)
		}
		tokens.appendChild(t)
	}
	for (const pid in (c.markers || {})) {
		if (c.markers[pid] > 0) {
			var m = document.createElement("span")
			m.className = "token"
			m.textContent = `⚖${FW.ROLE_BADGES[pid] || "?"}${c.markers[pid]}`
			bind_tooltip(m, `${who_name(pid)} 在本城的维权标记：${c.markers[pid]} 个`)
			tokens.appendChild(m)
		}
	}
	clist.appendChild(tokens)
	root.appendChild(clist)

	// 城市整体可点（选城/旋转门）
	if (city_targets().indexOf(c.id) >= 0) {
		root.classList.add("clickable")
		bind_tooltip(root, c.name + "（点击选择这座城市）", "city")
		root.addEventListener("click", function () { try_action_on_city(c.id) })
	}
	return root
}

function pool_block(label, count, is_land, tip) {
	var div = document.createElement("div")
	div.className = "pool"
	var lab = document.createElement("span")
	lab.className = "label"
	lab.textContent = label + " "
	div.appendChild(lab)
	var row = document.createElement("div")
	row.className = "stackrow"
	for (let i = 0; i < Math.min(count, 6); ++i) {
		var cd = document.createElement("div")
		cd.className = "cardlet" + (is_land ? " land" : "")
		cd.textContent = is_land ? "地" : "贷"
		row.appendChild(cd)
	}
	if (count === 0) {
		var empty = document.createElement("i")
		empty.textContent = "已拍完"
		row.appendChild(empty)
	} else if (count > 6) {
		var more = document.createElement("i")
		more.textContent = "+" + (count - 6)
		row.appendChild(more)
	}
	div.appendChild(row)
	bind_tooltip(div, tip, "city")
	return div
}

function rel_row(city, key, label) {
	var row = document.createElement("div")
	row.className = "relrow"
	var head = document.createElement("span")
	head.className = "relb"
	head.style.background = "#555"
	head.textContent = label
	row.appendChild(head)
	for (const p of (view.players || [])) {
		if (!p.alive)
			continue
		var v = city[key][p.id]
		// 每个玩家一组（色点 + 数字），整组换行不拆散
		var grp = document.createElement("span")
		grp.className = "relgrp"
		var badge = document.createElement("span")
		badge.className = "relbadge"
		badge.style.background = fw_color(p.id)
		badge.textContent = FW.ROLE_BADGES[p.id] || p.id
		grp.appendChild(badge)
		var chip = document.createElement("span")
		chip.className = "relchip"
		chip.style.color = fw_color(p.id)
		chip.style.borderColor = fw_color(p.id)
		chip.textContent = v
		bind_tooltip(chip, `${who_name(p.id)} 在 ${city.name} 的${key === "gov_rel" ? "本地" : "银行"}关系：${v}` +
			(key === "bank_rel" ? "\n>3 可免费展期1阶段；>6 可展期2阶段" : "\n≤-2 回合结束会被逮捕"),
			"rel")
		grp.appendChild(chip)
		row.appendChild(grp)
	}
	return row
}

// 点击城市 → 当前最合适的选城动作
function try_action_on_city(cid) {
	if (can("choose_city", cid)) {
		send_action("choose_city", cid)
		return
	}
	if (can("choose_card_city", cid)) {
		send_action("choose_card_city", cid)
		return
	}
	if (can("rot_to_bank", cid)) {
		send_action("rot_to_bank", cid)
		return
	}
	if (can("rot_to_gov", cid))
		send_action("rot_to_gov", cid)
}

// ---------- 玩家面板（横排 2~3 个；手牌/地块公开） ----------

function render_players() {
	var box = document.getElementById("players")
	box.replaceChildren()
	if (!(view.players || []).length)
		return

	var targetIds = Array.isArray(A("choose_card_player")) ? A("choose_card_player") : []
	var mine = myRole

	// 固定每行 3 块（2 人局也占满一行三格位，保持版面稳定）
	var row = null
	;(view.players || []).forEach(function (p, i) {
		if (i % 3 === 0) {
			row = document.createElement("div")
			row.className = "payer-row"
			box.appendChild(row)
		}
		row.appendChild(player_panel(p, targetIds, mine))
	})
}

function player_panel(p, targetIds, mine) {
	var root = document.createElement("div")
	root.className = "payer" +
		(view.active === p.id ? " active" : "") +
		(targetIds.indexOf(p.id) >= 0 ? " targetable" : "")

	var head = document.createElement("div")
	head.className = "payer-head"
	var dot = document.createElement("span")
	dot.className = "payer-dot"
	dot.style.background = fw_color(p.id)
	head.appendChild(dot)
	var nm = document.createElement("span")
	nm.className = "payer-name"
	// 显示真实用户名（client.js 的 roles 表），无用户名时回退角色名；企业名作前缀
	var uname = (typeof roles === "object" && roles[p.id] && roles[p.id].user_name) ? roles[p.id].user_name : null
	nm.textContent = (mine === p.id ? "▶ " : "") + who_name(p.id) + "·" + (uname || "") + (p.alive ? "" : "（已出局）")
	head.appendChild(nm)
	var cash = document.createElement("span")
	cash.className = "payer-cash"
	cash.textContent = p.alive ? fw_fmt_cash(p.cash) : "—"
	head.appendChild(cash)
	root.appendChild(head)

	var body = document.createElement("div")
	body.className = "payer-body"
	if (p.alive) {
		// 手牌（卡）仅本人可见；地块公开（view.lands）
		var myHands = mine === p.id ? (view.hands[p.id] || []) : []
		var handCount = view.hand_sizes[p.id] || 0
		var lands = view.lands[p.id] || []
		body.appendChild(payer_line("地块", lands, p, mine, undefined, "已卖出的地块会出现在对应城市的消费者池"))
		body.appendChild(payer_line("贷款", (view.loans || []).filter(function (l) { return l.owner === p.id }), p, mine))
		body.appendChild(payer_line("手牌", myHands, p, mine, handCount))
	}
	root.appendChild(body)

	if (targetIds.indexOf(p.id) >= 0) {
		root.addEventListener("click", function () { send_action("choose_card_player", p.id) })
		bind_tooltip(root, `点击：将 ${who_name(p.id)} 选为目标玩家`, "rel")
	}
	return root
}

function payer_line(label, items, p, mine, count, hint) {
	var line = document.createElement("div")
	line.className = "payer-line"
	var lab = document.createElement("span")
	lab.className = "plabel"
	lab.textContent = label
	if (hint)
		bind_tooltip(lab, hint)
	line.appendChild(lab)

	if (label === "关系") {
		for (const c of items) {
			// 城市名 + 政/银徽章（标签小字、数值大号加粗）
			var cchip = document.createElement("span")
			cchip.className = "relcity"
			cchip.textContent = c.name
			line.appendChild(cchip)
			line.appendChild(rel_badge(c, p, "政", c.gov_rel[p.id], "gov"))
			line.appendChild(rel_badge(c, p, "银", c.bank_rel[p.id], "bank"))
		}
		if (!items.length)
			line.appendChild(empty_hint("无"))
		return line
	}
	if (label === "贷款") {
		for (const l of items) {
			var dueIn = (l.due || 0) - (view.counter || 0)
			var chip = document.createElement("span")
			var urgent = dueIn <= 0 // 已到期/逾期
			var soon = dueIn > 0 && dueIn <= 2
			chip.className = "pcard" + (urgent ? " due-now" : soon ? " due-soon" : "")
			chip.textContent = `${urgent ? "⚠" : ""}${city_name(l.city)} ${fw_fmt_cash(l.principal)}×${fmt_mult10(l.mult10)}（${urgent ? "立即偿还！" : dueIn + " 阶段后到期"}）`
			bind_tooltip(chip, `贷款 ${fw_fmt_cash(l.principal)} · 偿还倍数 ${fmt_mult10(l.mult10)} · 到期阶段 ${l.due}`, "loan")
			line.appendChild(chip)
		}
		if (!items.length)
			line.appendChild(empty_hint("无"))
		return line
	}

	// 关系徽章：标签（政/银）小号灰字，数值大号加粗并按关系色强调
function rel_badge(city, p, label, value, kind) {
	var wrap = document.createElement("span")
	wrap.className = "relwrap"
	var lab = document.createElement("span")
	lab.className = "rellab"
	lab.textContent = label
	wrap.appendChild(lab)
	var num = document.createElement("span")
	num.className = "relnum"
	num.textContent = value
	num.style.color = fw_color(p.id)
	wrap.appendChild(num)
	var danger = kind === "gov" ? value <= -2 : false
	if (danger)
		wrap.classList.add("danger")
	bind_tooltip(wrap,
		`${who_name(p.id)} 在 ${city.name} 的${label}关系：${value}` +
		(kind === "bank" ? "\n>3 可免费展期1阶段；>6 可展期2阶段" : "\n≤-2 回合结束会被逮捕"), "rel")
	return wrap
}

// 地块 / 手牌：仅手牌对他人数数隐藏（count 为数字时）；地块始终公开明细
	if (typeof count === "number" && mine !== p.id) {
		var cnt = document.createElement("span")
		cnt.className = "pcard dead"
		cnt.textContent = count + " 张"
		bind_tooltip(cnt, `${who_name(p.id)} 的${label}：${count} 张（详情仅本人可见）`, "card")
		line.appendChild(cnt)
		return line
	}

	var cards = document.createElement("span")
	cards.className = "phand"
	for (const h of items) {
		var el = document.createElement("span")
		el.className = "pcard"
		var hint, playable = false
		if (label === "地块") {
			el.classList.add("land")
			hint = `地块 · 底价 ${fw_fmt_cash(h.base)} · 归属 ${city_name(h.city)}`
			if (mine === p.id && can("sell_land", h.uid)) {
				playable = true
				hint += `\n→ 点击放入消费者池（回收 底价×${city_by_id(h.city).housing}）`
			} else if (mine === p.id && can("choose_card_land", h.uid)) {
				playable = true
				hint += "\n→ 点击选作配套商圈目标"
			}
			el.textContent = `地·${fw_fmt_cash(h.base)}·${city_name(h.city)}`
		} else {
			// 卡牌三段结构：名称 / 效果 / 额外新闻（直接显示，不悬停）
			el.classList.add("card")
			hint = (FW.CARD_LABELS[h.card] || h.label)
			if (h.desc) hint += "\n" + h.desc
			if (mine === p.id && can("play_card", h.uid)) {
				playable = true
				hint += "\n→ 点击打出"
			}
			var cname = document.createElement("b")
			cname.className = "card-name"
			cname.textContent = FW.CARD_LABELS[h.card] || h.label
			el.appendChild(cname)
			if (h.desc) {
				var cdesc = document.createElement("span")
				cdesc.className = "card-desc"
				cdesc.textContent = h.desc
				el.appendChild(cdesc)
			}
			if (h.news) {
				var cnews = document.createElement("span")
				cnews.className = "card-news"
				cnews.textContent = h.news
				el.appendChild(cnews)
			}
		}
		if (playable) {
			el.classList.add("playable")
			el.addEventListener("click", function () {
				if (can("play_card", h.uid)) send_action("play_card", h.uid)
				else if (can("sell_land", h.uid)) send_action("sell_land", h.uid)
				else if (can("choose_card_land", h.uid)) send_action("choose_card_land", h.uid)
			})
		}
		bind_tooltip(el, hint, h.kind === "land" ? "land" : "card")
		cards.appendChild(el)
	}
	if (!items.length)
		line.appendChild(empty_hint("无"))
	line.appendChild(cards)
	return line
}

function empty_hint(text) {
	var s = document.createElement("span")
	s.className = "pcard dead"
	s.textContent = text
	return s
}

// ---------- 侧栏（纯角色卡：中文角色名 + 彩带，统计信息都在玩家面板） ----------

function render_sidebar() {
	var seats = {}
	for (const p of (view.players || []))
		seats[p.id] = true
	for (const rid of FW.ROLES) {
		var rowEl = document.getElementById("role_" + rid)
		if (rowEl) {
			rowEl.classList.toggle("hidden", !seats[rid])
			// 侧栏角色名显示企业名（client.js 写入英文角色名，这里覆盖）
			var rn = rowEl.querySelector(".role_name")
			if (rn)
				rn.textContent = FW.ROLE_NAMES[rid] || rid
		}
	}
	document.getElementById("turn_info").textContent =
		view.state === "game_over" ? "游戏结束" :
		`第 ${view.round} 回合（最多4） · 第 ${view.phase} 阶段（最多6）`
}

// ---------- 共用工具 ----------

function make_panel(title, text) {
	var p = document.createElement("div")
	p.className = "panel"
	var h = document.createElement("h3")
	h.textContent = title
	p.appendChild(h)
	var d = document.createElement("div")
	d.className = "text"
	d.style.whiteSpace = "pre-line"
	d.textContent = text
	p.appendChild(d)
	return p
}

function city_by_id(cid) {
	return (view.cities || []).find(function (c) { return c.id === cid }) || { name: cid, housing: 1 }
}

function city_name(cid) {
	return city_by_id(cid).name
}

function who_name(pid) {
	return FW.ROLE_NAMES[pid] || pid
}

function fmt_mult10(m10) {
	return (m10 / 10).toFixed(1)
}

function my_turn() {
	return myRole && myRole !== "Observer" && view.active === myRole && view.actions
}

// ---------- 悬停提示（按信息类型加图标分类） ----------

function bind_tooltip(el, text, kind) {
	el.addEventListener("mouseenter", function (evt) { show_tooltip(evt, text, kind) })
	el.addEventListener("mousemove", move_tooltip)
	el.addEventListener("mouseleave", hide_tooltip)
}

function show_tooltip(e, text, kind) {
	var tip = document.getElementById("tooltip")
	tip.textContent = text
	tip.className = kind ? "tip-" + kind : ""
	tip.hidden = false
	move_tooltip_at(e)
}

function move_tooltip(e) {
	if (e && e.clientX !== undefined && !document.getElementById("tooltip").hidden)
		move_tooltip_at(e)
}

function move_tooltip_at(e) {
	var tip = document.getElementById("tooltip")
	var x = e.clientX + 14
	var y = e.clientY + 16
	var r = tip.getBoundingClientRect()
	if (x + r.width > window.innerWidth - 8)
		x = e.clientX - r.width - 10
	if (y + r.height > window.innerHeight - 8)
		y = e.clientY - r.height - 10
	tip.style.left = x + "px"
	tip.style.top = y + "px"
}

function hide_tooltip() {
	document.getElementById("tooltip").hidden = true
}