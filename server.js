const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL 连接池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ================== 数据库初始化 ==================
(async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ 数据库连接成功');

        // 创建 partners 表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS partners (
                id SERIAL PRIMARY KEY,
                token VARCHAR(64) UNIQUE NOT NULL,
                wechat VARCHAR(100),
                address TEXT,
                deadline VARCHAR(50),
                gift_extra TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 为 survey_results 添加 partner_id 字段
        await pool.query(`
            ALTER TABLE survey_results ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id)
        `);

        // 添加 name 和 phone 字段（如果不存在）
        await pool.query(`ALTER TABLE survey_results ADD COLUMN IF NOT EXISTS name TEXT`);
        await pool.query(`ALTER TABLE survey_results ADD COLUMN IF NOT EXISTS phone TEXT`);

        // 移除旧的唯一约束（如果存在），添加联合唯一约束（partner_id + phone）
        await pool.query(`ALTER TABLE survey_results DROP CONSTRAINT IF EXISTS unique_phone`);
        await pool.query(`
            ALTER TABLE survey_results ADD CONSTRAINT unique_partner_phone UNIQUE (partner_id, phone)
        `).catch(err => console.log('唯一约束可能已存在', err.message));

        console.log('✅ 数据库初始化完成');
    } catch (err) {
        console.error('数据库初始化失败:', err.message);
    }
})();

// ================== 合伙人相关 API ==================

// 合伙人注册
app.post('/api/partner/register', async (req, res) => {
    const { wechat, address, deadline, giftExtra } = req.body;
    if (!wechat) {
        return res.status(400).json({ error: '请填写微信号' });
    }

    // 检查微信号是否已注册（可选，如需禁止重复注册则取消注释）
    // const existing = await pool.query('SELECT token FROM partners WHERE wechat = $1', [wechat]);
    // if (existing.rows.length > 0) {
    //     return res.json({ success: true, token: existing.rows[0].token });
    // }

    // 生成唯一 token（8位十六进制）
    let token;
    let tokenExists = true;
    while (tokenExists) {
        token = crypto.randomBytes(8).toString('hex');
        const check = await pool.query('SELECT id FROM partners WHERE token = $1', [token]);
        if (check.rows.length === 0) tokenExists = false;
    }

    try {
        await pool.query(
            `INSERT INTO partners (token, wechat, address, deadline, gift_extra)
             VALUES ($1, $2, $3, $4, $5)`,
            [token, wechat, address || '', deadline || '', giftExtra || '']
        );
        res.json({ success: true, token });
    } catch (err) {
        console.error('注册失败:', err);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// 获取合伙人信息
app.get('/api/partner/:token', async (req, res) => {
    const { token } = req.params;
    try {
        const result = await pool.query('SELECT * FROM partners WHERE token = $1', [token]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '合伙人不存在' });
        }
        const partner = result.rows[0];
        res.json({
            id: partner.id,
            token: partner.token,
            wechat: partner.wechat || '',
            address: partner.address || '',
            deadline: partner.deadline || '',
            giftExtra: partner.gift_extra || ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 更新合伙人配置
app.put('/api/partner/:token', async (req, res) => {
    const { token } = req.params;
    const { wechat, address, deadline, giftExtra } = req.body;
    try {
        await pool.query(
            `UPDATE partners SET wechat = $1, address = $2, deadline = $3, gift_extra = $4 WHERE token = $5`,
            [wechat, address, deadline, giftExtra, token]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新失败' });
    }
});

// 获取合伙人的客户记录
app.get('/api/partner/:token/records', async (req, res) => {
    const { token } = req.params;
    try {
        const partner = await pool.query('SELECT id FROM partners WHERE token = $1', [token]);
        if (partner.rows.length === 0) return res.status(404).json({ error: '合伙人不存在' });
        const partnerId = partner.rows[0].id;
        const records = await pool.query(
            `SELECT * FROM survey_results WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 500`,
            [partnerId]
        );
        res.json(records.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 删除客户记录（仅限该合伙人的）
app.delete('/api/partner/:token/records/:id', async (req, res) => {
    const { token, id } = req.params;
    try {
        const partner = await pool.query('SELECT id FROM partners WHERE token = $1', [token]);
        if (partner.rows.length === 0) return res.status(404).json({ error: '合伙人不存在' });
        const partnerId = partner.rows[0].id;
        const result = await pool.query(
            'DELETE FROM survey_results WHERE id = $1 AND partner_id = $2 RETURNING id',
            [id, partnerId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: '记录不存在或无权删除' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '删除失败' });
    }
});

// ================== 客户提交测评 ==================
app.post('/api/submit', async (req, res) => {
    const { totalScore, level, title, slogan, wechatConfig, name, phone, partnerToken } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (totalScore === undefined) {
        return res.status(400).json({ error: '缺少必填字段 totalScore' });
    }

    try {
        let partnerId = null;
        if (partnerToken) {
            const partner = await pool.query('SELECT id FROM partners WHERE token = $1', [partnerToken]);
            if (partner.rows.length > 0) partnerId = partner.rows[0].id;
        }

        const result = await pool.query(
            `INSERT INTO survey_results 
             (total_score, level, title, slogan, wechat_config, name, phone, user_agent, ip, partner_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [totalScore, level, title, slogan, wechatConfig, name || '', phone || '', userAgent, ip, partnerId]
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

// ================== 全局后台（可选） ==================
app.get('/admin', async (req, res) => {
    res.send('全局后台已移至合伙人后台，请使用 /partner.html?token=xxx 访问');
});

// ================== 启动服务 ==================
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`注册页面: http://localhost:${PORT}/register.html`);
    console.log(`合伙人后台示例: http://localhost:${PORT}/partner.html?token=your_token`);
});