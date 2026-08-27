// 参考 register-imperial.js：把朋友的酒模块注册进 titles 表
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const db = new sqlite3.Database('./db');
const sql = fs.readFileSync('./public/friends-wine/title.sql', 'utf8');
db.exec(sql, (err) => {
	if (err) console.error('注册失败：', err.message);
	else console.log('✅ friends-wine 模块注册成功！');
	db.close();
});
