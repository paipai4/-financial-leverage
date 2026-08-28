"use strict"

// 朋友的酒 - 前端静态常量（服务器视图里没有的展示层数据）

var FW = {
	ROLES: ["Wang", "Li", "Zhao", "Sun", "Qian", "Zhou"],
	ROLE_NAMES: {
		Wang: "王总", Li: "李总", Zhao: "徐总",
		Sun: "孙总", Qian: "张总", Zhou: "周总",
	},
	ROLE_BADGES: { Wang: "旺", Li: "龙", Zhao: "久", Sun: "柯", Qian: "币", Zhou: "格" },

	// 企业名与代表色（新规则）：旺达王总金、龙创李总紫、久大徐总蓝、旺柯孙总灰、币贵张总橙红、格陵兰周总翠绿
	COMPANY: {
		Wang: "旺达", Li: "龙创", Zhao: "久大",
		Sun: "旺柯", Qian: "币贵", Zhou: "格陵兰",
	},
	COLORS: {
		Wang: "#b8860b", // 金
		Li: "#7d5ba6",   // 紫
		Zhao: "#4470b0", // 蓝
		Sun: "#888888",  // 灰
		Qian: "#e07020", // 橙红
		Zhou: "#2f8f5f", // 翠绿
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
		ewai: "特批贷款",
		fangnao: "房闹",
		jianguan: "金融监管",
		tafang: "塌方型腐败",
		zhanqi: "展期谈判",
		fangzhu: "房住不炒",
		huazhai: "化债工作组",
		jidui: "挤兑",
		baojiao: "保交楼",
		fanfu: "金融反腐",
		yingzhuolu: "硬着陆",
		dizhichongzu: "抵押重组",
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
