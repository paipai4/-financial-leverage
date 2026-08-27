"use strict"

// 朋友的酒 - 前端静态常量（服务器视图里没有的展示层数据）

var FW = {
	ROLES: ["Wang", "Li", "Zhao", "Sun", "Qian", "Zhou"],
	ROLE_NAMES: {
		Wang: "王总", Li: "李总", Zhao: "赵总",
		Sun: "孙总", Qian: "钱总", Zhou: "周总",
	},
	ROLE_BADGES: { Wang: "王", Li: "李", Zhao: "赵", Sun: "孙", Qian: "钱", Zhou: "周" },

	// 玩家代表色（关系徽章 / 头像点 / 地块描边）：POG 式浅底色的深色版本
	COLORS: {
		Wang: "#b04040", // 红
		Li: "#4470b0",   // 蓝
		Zhao: "#3f8f4f", // 绿
		Sun: "#b08a3e",  // 杏黄
		Qian: "#7d5ba6", // 紫
		Zhou: "#2f8f8f", // 青
	},

	CARD_LABELS: {
		weilie: "围猎",
		huikou: "回扣",
		chaofang: "炒房团",
		loushi: "楼市大热",
		peitao: "配套商圈",
		shangpiao: "商票垫资",
		xuanzhuan: "旋转门",
		shuanggui: "双规",
		jingwai: "境外融资",
		dingxiang: "定向招拍",
		ewai: "额外贷款",
		fangnao: "房闹",
		jianguan: "金融监管",
		tafang: "塌方型腐败",
		zhanqi: "展期谈判",
		fangzhu: "房住不炒",
		baojiao: "保交楼",
		fanfu: "金融反腐",
	},
}

function fw_fmt_cash(n) {
	if (n >= 10000) {
		var yi = Math.floor(n / 10000)
		var rem = n % 10000
		return rem > 0 ? yi + "亿" + rem + "万" : yi + "亿"
	}
	return n + "万"
}

function fw_color(pid) {
	return FW.COLORS[pid] || "#777"
}
