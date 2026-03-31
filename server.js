const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================== 数据文件路径 ==================
const PARTNERS_FILE = path.join(__dirname, 'partners.json');
const DATA_FILE = path.join(__dirname, 'data.json');

// 初始化数据文件
if (!fs.existsSync(PARTNERS_FILE)) fs.writeFileSync(PARTNERS_FILE, '[]', 'utf8');
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

// ================== 辅助函数 ==================
function readPartners() {
    return JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8'));
}
function writePartners(partners) {
    fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2), 'utf8');
}
function readData() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ================== 合伙人 API ==================

// 1. 注册
app.post('/api/partner/register', (req, res) => {
    const { wechat, address, deadline, giftExtra } = req.body;
    if (!wechat) return res.status(400).json({ error: '请填写微信号' });

    const partners = readPartners();
    // 检查微信号是否已存在（可选，若允许重复注册则注释掉）
    const existing = partners.find(p => p.wechat === wechat);
    if (existing) {
        return res.json({ success: true, token: existing.token });
    }

    // 生成唯一 token
    let token;
    let exists = true;
    while (exists) {
        token = crypto.randomBytes(8).toString('hex');
        exists = partners.some(p => p.token === token);
    }

    const newPartner = {
        id: Date.now(),
        token,
        wechat,
        address: address || '',
        deadline: deadline || '',
        giftExtra: giftExtra || '',
        createdAt: new Date().toISOString()
    };
    partners.push(newPartner);
    writePartners(partners);
    res.json({ success: true, token });
});

// 2. 获取合伙人信息
app.get('/api/partner/:token', (req, res) => {
    const { token } = req.params;
    const partners = readPartners();
    const partner = partners.find(p => p.token === token);
    if (!partner) return res.status(404).json({ error: '合伙人不存在' });
    res.json({
        id: partner.id,
        token: partner.token,
        wechat: partner.wechat,
        address: partner.address,
        deadline: partner.deadline,
        giftExtra: partner.giftExtra
    });
});

// 3. 更新合伙人配置
app.put('/api/partner/:token', (req, res) => {
    const { token } = req.params;
    const { wechat, address, deadline, giftExtra } = req.body;
    const partners = readPartners();
    const index = partners.findIndex(p => p.token === token);
    if (index === -1) return res.status(404).json({ error: '合伙人不存在' });
    partners[index] = {
        ...partners[index],
        wechat: wechat || '',
        address: address || '',
        deadline: deadline || '',
        giftExtra: giftExtra || ''
    };
    writePartners(partners);
    res.json({ success: true });
});

// 4. 获取合伙人的客户记录
app.get('/api/partner/:token/records', (req, res) => {
    const { token } = req.params;
    const partners = readPartners();
    const partner = partners.find(p => p.token === token);
    if (!partner) return res.status(404).json({ error: '合伙人不存在' });
    const allData = readData();
    const records = allData.filter(r => r.partnerId === partner.id).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(records);
});

// 5. 删除客户记录
app.delete('/api/partner/:token/records/:id', (req, res) => {
    const { token, id } = req.params;
    const partners = readPartners();
    const partner = partners.find(p => p.token === token);
    if (!partner) return res.status(404).json({ error: '合伙人不存在' });
    let allData = readData();
    const recordIndex = allData.findIndex(r => r.id == id && r.partnerId === partner.id);
    if (recordIndex === -1) return res.status(404).json({ error: '记录不存在或无权删除' });
    allData.splice(recordIndex, 1);
    writeData(allData);
    res.json({ success: true });
});

// ================== 客户提交测评 ==================
app.post('/api/submit', (req, res) => {
    const { totalScore, level, title, slogan, wechatConfig, name, phone, partnerToken } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (totalScore === undefined) {
        return res.status(400).json({ error: '缺少必填字段 totalScore' });
    }

    // 查找合伙人
    let partnerId = null;
    if (partnerToken) {
        const partners = readPartners();
        const partner = partners.find(p => p.token === partnerToken);
        if (partner) partnerId = partner.id;
    }

    const allData = readData();
    // 手机号重复检查（同一合伙人下）
    if (partnerId && phone) {
        const exists = allData.some(r => r.partnerId === partnerId && r.phone === phone);
        if (exists) {
            return res.status(409).json({ error: '该手机号已提交过，不可重复提交' });
        }
    }

    const newRecord = {
        id: Date.now(),
        totalScore,
        level: level || '',
        title: title || '',
        slogan: slogan || '',
        wechatConfig: wechatConfig || '',
        name: name || '',
        phone: phone || '',
        ip: ip || '',
        userAgent: userAgent || '',
        partnerId,
        createdAt: new Date().toISOString()
    };
    allData.unshift(newRecord);
    writeData(allData);
    res.json({ success: true, id: newRecord.id });
});

// ================== 管理员功能 ==================
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

// 获取所有合伙人及客户统计
app.get('/api/admin/stats', (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_KEY) {
        return res.status(403).json({ error: '无权访问' });
    }
    const partners = readPartners();
    const allData = readData();

    const partnerStats = partners.map(p => {
        const customers = allData.filter(d => d.partnerId === p.id);
        return {
            ...p,
            customerCount: customers.length,
            customers: customers.map(c => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                totalScore: c.totalScore,
                level: c.level,
                createdAt: c.createdAt
            }))
        };
    });
    res.json(partnerStats);
});

// 删除合伙人（谨慎操作，关联客户数据将失去归属）
app.delete('/api/admin/partner/:id', (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_KEY) {
        return res.status(403).json({ error: '无权访问' });
    }
    const partnerId = parseInt(req.params.id);
    let partners = readPartners();
    const index = partners.findIndex(p => p.id === partnerId);
    if (index === -1) return res.status(404).json({ error: '合伙人不存在' });
    partners.splice(index, 1);
    writePartners(partners);

    // 将关联客户数据的 partnerId 置为 null（保留客户记录但无归属）
    let allData = readData();
    allData = allData.map(d => {
        if (d.partnerId === partnerId) {
            return { ...d, partnerId: null };
        }
        return d;
    });
    writeData(allData);

    res.json({ success: true });
});

// ================== 全局后台提示 ==================
app.get('/admin', (req, res) => {
    res.send('全局后台已移至 /admin.html?key=xxx 访问');
});

// ================== 启动服务 ==================
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`注册页面: http://localhost:${PORT}/register.html`);
    console.log(`合伙人后台: http://localhost:${PORT}/partner.html?token=您的token`);
    console.log(`管理员后台: http://localhost:${PORT}/admin.html?key=${ADMIN_KEY}`);
});