const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

(async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ 数据库连接成功');
        // 创建表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS survey_results (
                id SERIAL PRIMARY KEY,
                total_score INTEGER,
                level TEXT,
                title TEXT,
                slogan TEXT,
                wechat_config TEXT,
                name TEXT,
                phone TEXT,
                user_agent TEXT,
                ip TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // 添加唯一约束（防止手机号重复）
        await pool.query(`
            ALTER TABLE survey_results 
            ADD CONSTRAINT IF NOT EXISTS unique_phone UNIQUE (phone)
        `).catch(err => console.log('唯一约束可能已存在', err.message));
        console.log('✅ 表结构已就绪');
    } catch (err) {
        console.error('数据库初始化失败:', err);
    }
})();

// 提交测评
app.post('/api/submit', async (req, res) => {
    const { totalScore, level, title, slogan, wechatConfig, name, phone } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (totalScore === undefined) {
        return res.status(400).json({ error: '缺少必填字段 totalScore' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO survey_results 
             (total_score, level, title, slogan, wechat_config, name, phone, user_agent, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [totalScore, level, title, slogan, wechatConfig, name || '', phone || '', userAgent, ip]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: '该手机号已提交过，不可重复提交' });
        }
        console.error('插入失败:', err);
        res.status(500).json({ error: '数据存储失败', detail: err.message });
    }
});

// 编辑记录
app.put('/api/records/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { name, phone, totalScore, level, title, wechatConfig } = req.body;
    try {
        await pool.query(
            `UPDATE survey_results SET 
                name = $1, phone = $2, total_score = $3, level = $4, 
                title = $5, wechat_config = $6 
             WHERE id = $7`,
            [name, phone, totalScore, level, title, wechatConfig, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('更新失败:', err);
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除记录
app.delete('/api/records/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query('DELETE FROM survey_results WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('删除失败:', err);
        res.status(500).json({ error: '删除失败' });
    }
});

// 管理后台（带编辑/删除界面）
app.get('/admin', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM survey_results ORDER BY created_at DESC LIMIT 200');
        const rows = result.rows;
        // 此处插入上面提供的/admin完整HTML代码（略）
        // 由于长度限制，请复制上面给出的/admin代码
        // ... 
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