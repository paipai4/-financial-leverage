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

// ---------- 结构化日志（仿 POG 色带，参考 shanghai1937） ----------
// 服务端日志约定：".h1 " 回合标题、".h2 " 阶段标题、"*" 加粗事件

function on_log(text) {
	var p = document.createElement("div")
	if (text.startsWith(".h1 ")) {
		text = text.substring(4)
		p.className = "h1"
	} else if (text.startsWith(".h2 ")) {
		text = text.substring(4)
		p.className = "h2"
	} else if (text.startsWith("*")) {
		text = text.substring(1)
		p.className = "bold"
	}
	p.textContent = text
	return p
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
		["transfer_half", "转一半（政府+1）"],
		["transfer_all", "全部转贷（政府+2）"],
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

	var inner = document.createElement("div")
	inner.className = "body"
	var lines = []
	lines.push(`拍品：${bid.kind === "loan" ? "贷款" : "土地"} ${fw_fmt_cash(bid.amount)}`)
	lines.push(bid.high
		? `当前最高：${who_name(bid.high)} ${bid.kind === "loan" ? fmt_mult10(bid.mult) + " 倍" : bid.mult + " 倍"}`
		: "暂无报价，等待起拍……")
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

// ---------- 信息面板（拍卖台当拍品描述，附带排队预览） ----------

function render_stage() {
	var el = document.getElementById("stage")
	el.replaceChildren()
	if (view.state === "game_over") {
		el.appendChild(make_panel("终局", String(view.prompt)))
		return
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
		"消费者回收现金 = 底价 × 该倍数；造房费用 = 底价")
	root.appendChild(hbtn)

	root.appendChild(pool_block("银行池", c.banks_left, false,
		`每回合 4 笔贷款，正面朝下堆叠\n每阶段翻出最上面 1 笔进入竞拍（1.5~5倍偿还）\n剩余 ${c.banks_left} 笔未翻`))
	root.appendChild(pool_block("政府池", c.govs_left, true,
		`每回合 4 块土地，正面朝下堆叠\n每阶段翻出最上面 1 块进入竞拍（2~10倍底价）\n剩余 ${c.govs_left} 块未翻`))

	var rels = document.createElement("div")
	rels.className = "rels"
	rels.appendChild(rel_row(c, "gov_rel", "政"))
	rels.appendChild(rel_row(c, "bank_rel", "银"))
	root.appendChild(rels)

	var con = c.consumer || []
	var hasMarkers = Object.keys(c.markers || {}).some(function (k) { return c.markers[k] > 0 })
	if (con.length > 0 || hasMarkers) {
		var clist = document.createElement("div")
		clist.className = "consumer-list"
		for (const tok of con) {
			var t = document.createElement("span")
			t.className = "token" + (tok.paid ? " paid" : "")
			t.style.borderColor = fw_color(tok.owner)
			t.textContent = `${FW.ROLE_BADGES[tok.owner] || "?"}${tok.base}万${tok.paid ? "✓" : ""}`
			bind_tooltip(t,
				`${who_name(tok.owner)} 的地块 · 底价 ${fw_fmt_cash(tok.base)}\n` +
				(tok.paid ? "已支付造房费用，回合结束时交付房产" : "未交付：回合结束获得 1 个维权标记") +
				"\n每 3 个维权标记：政府关系-1 并收回一块地")
			// 支付造房费：绿框可点
			if (!tok.paid && can("develop_land", tok.token)) {
				t.classList.add("developable")
				t.addEventListener("click", function () { send_action("develop_land", tok.token) })
			}
			clist.appendChild(t)
		}
		for (const pid in (c.markers || {})) {
			if (c.markers[pid] > 0) {
				var m = document.createElement("span")
				m.className = "token"
				m.textContent = `⚖${FW.ROLE_BADGES[pid] || "?"}${c.markers[pid]}`
				bind_tooltip(m, `${who_name(pid)} 在本城的维权标记：${c.markers[pid]} 个`)
				clist.appendChild(m)
			}
		}
		root.appendChild(clist)
	}

	// 城市整体可点（选城/旋转门）
	if (city_targets().indexOf(c.id) >= 0) {
		root.classList.add("clickable")
		bind_tooltip(root, c.name + "（点击选择这座城市）")
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
	bind_tooltip(div, tip)
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
		var chip = document.createElement("span")
		chip.className = "relchip"
		chip.style.color = fw_color(p.id)
		chip.textContent = (FW.ROLE_BADGES[p.id] || p.id) + v
		bind_tooltip(chip, `${who_name(p.id)} 在 ${city.name} 的${key === "gov_rel" ? "政府" : "银行"}关系：${v}` +
			(key === "bank_rel" ? "\n>3 可免费展期1阶段；>6 可展期2阶段" : "\n≤-2 回合结束会被逮捕"))
		row.appendChild(chip)
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

	// 分成每行 2~3 块
	var row = null
	var perRow = (view.players || []).length <= 3 ? 2 : 3
	;(view.players || []).forEach(function (p, i) {
		if (i % perRow === 0) {
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
	nm.textContent = (mine === p.id ? "▶ " : "") + who_name(p.id) + (p.alive ? "" : "（已出局）")
	head.appendChild(nm)
	var cash = document.createElement("span")
	cash.className = "payer-cash"
	cash.textContent = p.alive ? fw_fmt_cash(p.cash) : "—"
	head.appendChild(cash)
	root.appendChild(head)

	var body = document.createElement("div")
	body.className = "payer-body"
	if (p.alive) {
		body.appendChild(payer_line("地块", (view.hands[p.id] || []).filter(function (h) { return h.kind === "land" }), p, mine))
		body.appendChild(payer_line("贷款", (view.loans || []).filter(function (l) { return l.owner === p.id }), p, mine))
		body.appendChild(payer_line("关系", (view.cities || []), p, mine))
		body.appendChild(payer_line("手牌", (view.hands[p.id] || []).filter(function (h) { return h.kind !== "land" }), p, mine))
	}
	root.appendChild(body)

	if (targetIds.indexOf(p.id) >= 0) {
		root.addEventListener("click", function () { send_action("choose_card_player", p.id) })
		bind_tooltip(root, `点击：将 ${who_name(p.id)} 选为目标玩家`)
	}
	return root
}

function payer_line(label, items, p, mine) {
	var line = document.createElement("div")
	line.className = "payer-line"
	var lab = document.createElement("span")
	lab.className = "plabel"
	lab.textContent = label
	line.appendChild(lab)

	if (label === "关系") {
		for (const c of items) {
			var chip = document.createElement("span")
			chip.className = "relchip"
			chip.style.color = fw_color(p.id)
			chip.textContent = `${c.name} 政${c.gov_rel[p.id]}/银${c.bank_rel[p.id]}`
			bind_tooltip(chip, `${c.name}：政府关系 ${c.gov_rel[p.id]}（≤-2 逮捕）· 银行关系 ${c.bank_rel[p.id]}（>3 展期1 / >6 展期2）`)
			line.appendChild(chip)
		}
		if (!items.length)
			line.appendChild(empty_hint("无"))
		return line
	}
	if (label === "贷款") {
		for (const l of items) {
			var chip = document.createElement("span")
			chip.className = "pcard" + (l.due <= (view.counter || 0) ? " dead" : "")
			chip.textContent = `${city_name(l.city)} ${fw_fmt_cash(l.principal)}×${fmt_mult10(l.mult10)}（${l.due - (view.counter || 0)} 阶段后到期）`
			bind_tooltip(chip, `贷款 ${fw_fmt_cash(l.principal)} · 偿还倍数 ${fmt_mult10(l.mult10)} · 到期阶段 ${l.due}`)
			line.appendChild(chip)
		}
		if (!items.length)
			line.appendChild(empty_hint("无"))
		return line
	}

	// 地块 / 手牌：公开芯片；地块墨绿底
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
			hint = (FW.CARD_LABELS[h.card] || h.label)
			if (h.desc) hint += "\n" + h.desc
			if (mine === p.id && can("play_card", h.uid)) {
				playable = true
				hint += "\n→ 点击打出"
			}
			el.textContent = FW.CARD_LABELS[h.card] || h.label
		}
		if (playable) {
			el.classList.add("playable")
			el.addEventListener("click", function () {
				if (can("play_card", h.uid)) send_action("play_card", h.uid)
				else if (can("sell_land", h.uid)) send_action("sell_land", h.uid)
				else if (can("choose_card_land", h.uid)) send_action("choose_card_land", h.uid)
			})
		}
		bind_tooltip(el, hint)
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

// ---------- 侧栏（简化为轮转/回合信息；选人目标在版图玩家面板上） ----------

function render_sidebar() {
	var seats = {}
	for (const p of (view.players || []))
		seats[p.id] = true
	for (const rid of FW.ROLES) {
		var rowEl = document.getElementById("role_" + rid)
		if (rowEl)
			rowEl.classList.toggle("hidden", !seats[rid])
	}
	for (const p of (view.players || [])) {
		var stat = document.getElementById("stat_" + p.id)
		if (stat) {
			stat.textContent = (p.alive ? `现金 ${fw_fmt_cash(p.cash)} · 手牌 ${view.hand_sizes[p.id] || 0}` : "已出局") +
				` · 贷款 ${(view.loans || []).filter(function (l) { return l.owner === p.id }).length} 笔`
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

// ---------- 悬停提示 ----------

function bind_tooltip(el, text) {
	el.addEventListener("mouseenter", function (evt) { show_tooltip(evt, text) })
	el.addEventListener("mousemove", move_tooltip)
	el.addEventListener("mouseleave", hide_tooltip)
}

function show_tooltip(e, text) {
	var tip = document.getElementById("tooltip")
	tip.textContent = text
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