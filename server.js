const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL 连接池（使用环境变量）
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Render 要求 SSL
});

// 创建表（如果不存在）
pool.query(`
    CREATE TABLE IF NOT EXISTS survey_results (
        id SERIAL PRIMARY KEY,
        total_score INTEGER,
        level TEXT,
        title TEXT,
        slogan TEXT,
        wechat_config TEXT,
        user_agent TEXT,
        ip TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error('创建表失败:', err));

// 接收测评数据
app.post('/api/submit', async (req, res) => {
    const { totalScore, level, title, slogan, wechatConfig } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (totalScore === undefined) {
        return res.status(400).json({ error: '缺少必填字段 totalScore' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO survey_results (total_score, level, title, slogan, wechat_config, user_agent, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [totalScore, level, title, slogan, wechatConfig, userAgent, ip]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '数据存储失败' });
    }
});

// 管理后台
app.get('/admin', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM survey_results ORDER BY created_at DESC LIMIT 200');
        const rows = result.rows;
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>测评数据统计</title>
                <style>
                    body { font-family: system-ui; padding: 20px; background: #f5f7fb; }
                    table { border-collapse: collapse; width: 100%; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
                    th { background: #1e4663; color: white; }
                    tr:nth-child(even) { background: #f9f9fc; }
                    .container { max-width: 1400px; margin: 0 auto; }
                    h1 { color: #1e3c72; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>📊 保险合伙人潜力测评统计</h1>
                    <p>共 ${rows.length} 条记录</p>
                    <table>
                        <thead>
                            <tr><th>ID</th><th>总分</th><th>等级</th><th>标题</th><th>微信号配置</th><th>IP</th><th>时间</th></tr>
                        </thead>
                        <tbody>
        `;
        rows.forEach(row => {
            html += `<tr>
                        <td>${row.id}</td>
                        <td>${row.total_score}</td>
                        <td>${escapeHtml(row.level)}</td>
                        <td>${escapeHtml(row.title)}</td>
                        <td>${escapeHtml(row.wechat_config)}</td>
                        <td>${escapeHtml(row.ip)}</td>
                        <td>${row.created_at}</td>
                    </tr>`;
        });
        html += `</tbody></table></div></body></html>`;
        res.send(html);
    } catch (err) {
        res.status(500).send('数据库查询失败');
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});