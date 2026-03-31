const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据目录
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 合伙人配置目录
const PARTNERS_DIR = path.join(DATA_DIR, 'partners');
if (!fs.existsSync(PARTNERS_DIR)) fs.mkdirSync(PARTNERS_DIR);

// 辅助函数：读取 JSON 文件，若不存在则返回默认值
function readJSON(filePath, defaultVal = null) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (err) {}
    return defaultVal;
}

function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ========== 合伙人 API ==========

// 获取合伙人信息
app.get('/api/partner/:token', (req, res) => {
    const { token } = req.params;
    const partnerFile = path.join(PARTNERS_DIR, `${token}.json`);
    const partner = readJSON(partnerFile);
    if (!partner) {
        return res.status(404).json({ error: '合伙人不存在' });
    }
    res.json({
        id: token,
        token,
        wechat: partner.wechat || '',
        address: partner.address || '',
        deadline: partner.deadline || '',
        giftExtra: partner.giftExtra || ''
    });
});

// 更新合伙人配置
app.put('/api/partner/:token', (req, res) => {
    const { token } = req.params;
    const { wechat, address, deadline, giftExtra } = req.body;
    const partnerFile = path.join(PARTNERS_DIR, `${token}.json`);
    let partner = readJSON(partnerFile);
    if (!partner) {
        partner = { token, wechat, address, deadline, giftExtra, records: [] };
    } else {
        partner.wechat = wechat;
        partner.address = address;
        partner.deadline = deadline;
        partner.giftExtra = giftExtra;
    }
    writeJSON(partnerFile, partner);
    res.json({ success: true });
});

// 获取合伙人的所有客户提交记录
app.get('/api/partner/:token/records', (req, res) => {
    const { token } = req.params;
    const partnerFile = path.join(PARTNERS_DIR, `${token}.json`);
    const partner = readJSON(partnerFile);
    if (!partner) {
        return res.status(404).json({ error: '合伙人不存在' });
    }
    res.json(partner.records || []);
});

// 删除某条记录
app.delete('/api/partner/:token/records/:id', (req, res) => {
    const { token, id } = req.params;
    const partnerFile = path.join(PARTNERS_DIR, `${token}.json`);
    const partner = readJSON(partnerFile);
    if (!partner) {
        return res.status(404).json({ error: '合伙人不存在' });
    }
    if (!partner.records) partner.records = [];
    const newRecords = partner.records.filter(r => r.id !== id);
    if (newRecords.length === partner.records.length) {
        return res.status(404).json({ error: '记录不存在' });
    }
    partner.records = newRecords;
    writeJSON(partnerFile, partner);
    res.json({ success: true });
});

app.post('/api/partner/register', async (req, res) => {
    const { wechat, address, deadline, giftExtra } = req.body;
    if (!wechat) return res.status(400).json({ error: '请填写微信号' });

    // 生成唯一 token
    const token = crypto.randomBytes(8).toString('hex');

    try {
        await pool.query(
            `INSERT INTO partners (token, wechat, address, deadline, gift_extra)
             VALUES ($1, $2, $3, $4, $5)`,
            [token, wechat, address || '', deadline || '', giftExtra || '']
        );
        res.json({ success: true, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});
    // 检查手机号是否已存在（同一合伙人下）
    const exists = partner.records.some(rec => rec.phone === phone);
    if (exists) {
        return res.status(409).json({ error: '该手机号已提交过，不可重复提交' });
    }

    const newRecord = {
        id: Date.now().toString(),
        totalScore,
        level: level || '',
        title: title || '',
        slogan: slogan || '',
        wechatConfig: wechatConfig || '',
        name: name || '',
        phone: phone || '',
        ip: ip || '',
        userAgent: userAgent || '',
        createdAt: new Date().toISOString()
    };
    partner.records.unshift(newRecord);
    writeJSON(partnerFile, partner);
    res.json({ success: true, id: newRecord.id });
});

// 可选：全局管理后台（仅管理员）
app.get('/admin', (req, res) => {
    res.send('请使用合伙人后台访问 /partner.html?token=xxx');
});



app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});