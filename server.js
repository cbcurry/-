const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据文件路径
const PARTNERS_FILE = path.join(__dirname, 'partners.json');
const DATA_FILE = path.join(__dirname, 'data.json');

// 初始化数据文件
if (!fs.existsSync(PARTNERS_FILE)) fs.writeFileSync(PARTNERS_FILE, '[]', 'utf8');
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

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

// 1. 注册（姓名 + 工号 + 密码）
app.post('/api/partner/register', (req, res) => {
    const { realName, employeeId, password } = req.body;
    if (!realName || !employeeId || !password) {
        return res.status(400).json({ error: '请填写姓名、工号和密码' });
    }
    if (!/^\d{9}$/.test(employeeId)) {
        return res.status(400).json({ error: '工号必须为9位数字' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6位' });
    }

    const partners = readPartners();
    if (partners.some(p => p.employeeId === employeeId)) {
        return res.status(409).json({ error: '该工号已注册，请勿重复注册' });
    }

    let token;
    do {
        token = crypto.randomBytes(8).toString('hex');
    } while (partners.some(p => p.token === token));

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    const newPartner = {
        id: Date.now(),
        token,
        realName,
        employeeId,
        password: hashedPassword,
        wechat: '',
        address: '',
        deadline: '',
        giftExtra: '',
        createdAt: new Date().toISOString()
    };
    partners.push(newPartner);
    writePartners(partners);
    res.json({ success: true, token });
});

// 2. 登录（工号 + 密码）
app.post('/api/partner/login', (req, res) => {
    const { employeeId, password } = req.body;
    if (!employeeId || !password) {
        return res.status(400).json({ error: '请填写工号和密码' });
    }
    const partners = readPartners();
    const partner = partners.find(p => p.employeeId === employeeId);
    if (!partner) {
        return res.status(401).json({ error: '工号或密码错误' });
    }
    const hashed = crypto.createHash('sha256').update(password).digest('hex');
    if (partner.password !== hashed) {
        return res.status(401).json({ error: '工号或密码错误' });
    }
    res.json({ success: true, token: partner.token });
});

// 3. 获取合伙人信息
app.get('/api/partner/:token', (req, res) => {
    const { token } = req.params;
    const partners = readPartners();
    const partner = partners.find(p => p.token === token);
    if (!partner) return res.status(404).json({ error: '合伙人不存在' });
    res.json({
        id: partner.id,
        token: partner.token,
        realName: partner.realName,
        employeeId: partner.employeeId,
        wechat: partner.wechat || '',
        address: partner.address || '',
        deadline: partner.deadline || '',
        giftExtra: partner.giftExtra || ''
    });
});

// 4. 更新合伙人配置
app.put('/api/partner/:token', (req, res) => {
    const { token } = req.params;
    const { realName, employeeId, wechat, address, deadline, giftExtra, password } = req.body;
    const partners = readPartners();
    const index = partners.findIndex(p => p.token === token);
    if (index === -1) return res.status(404).json({ error: '合伙人不存在' });

    if (employeeId && employeeId !== partners[index].employeeId) {
        if (!/^\d{9}$/.test(employeeId)) {
            return res.status(400).json({ error: '工号必须为9位数字' });
        }
        if (partners.some(p => p.employeeId === employeeId && p.token !== token)) {
            return res.status(409).json({ error: '工号已被其他合伙人使用' });
        }
    }

    const updated = { ...partners[index] };
    if (realName !== undefined) updated.realName = realName;
    if (employeeId !== undefined) updated.employeeId = employeeId;
    if (wechat !== undefined) updated.wechat = wechat;
    if (address !== undefined) updated.address = address;
    if (deadline !== undefined) updated.deadline = deadline;
    if (giftExtra !== undefined) updated.giftExtra = giftExtra;
    if (password) {
        if (password.length < 6) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }
        updated.password = crypto.createHash('sha256').update(password).digest('hex');
    }

    partners[index] = updated;
    writePartners(partners);
    res.json({ success: true });
});

// 5. 获取合伙人的客户记录
app.get('/api/partner/:token/records', (req, res) => {
    const { token } = req.params;
    const partners = readPartners();
    const partner = partners.find(p => p.token === token);
    if (!partner) return res.status(404).json({ error: '合伙人不存在' });
    const allData = readData();
    const records = allData.filter(r => r.partnerId === partner.id).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(records);
});

// 6. 删除客户记录
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

// ================== 客户提交测评（新增 age, gender） ==================
app.post('/api/submit', (req, res) => {
    const { totalScore, level, title, slogan, wechatConfig, name, phone, age, gender, partnerToken } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (totalScore === undefined) {
        return res.status(400).json({ error: '缺少必填字段 totalScore' });
    }

    let partnerId = null;
    if (partnerToken) {
        const partners = readPartners();
        const partner = partners.find(p => p.token === partnerToken);
        if (partner) partnerId = partner.id;
    }

    const allData = readData();
    if (phone && allData.some(r => r.phone === phone)) {
        return res.status(409).json({ error: '该手机号已提交过，不可重复提交' });
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
        age: age || null,
        gender: gender || '',
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

app.get('/api/admin/stats', (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_KEY) return res.status(403).json({ error: '无权访问' });
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
                age: c.age,
                gender: c.gender,
                totalScore: c.totalScore,
                level: c.level,
                createdAt: c.createdAt
            }))
        };
    });
    res.json(partnerStats);
});

app.delete('/api/admin/partner/:id', (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_KEY) return res.status(403).json({ error: '无权访问' });
    const partnerId = parseInt(req.params.id);
    let partners = readPartners();
    const index = partners.findIndex(p => p.id === partnerId);
    if (index === -1) return res.status(404).json({ error: '合伙人不存在' });
    partners.splice(index, 1);
    writePartners(partners);
    let allData = readData();
    allData = allData.map(d => {
        if (d.partnerId === partnerId) return { ...d, partnerId: null };
        return d;
    });
    writeData(allData);
    res.json({ success: true });
});

app.get('/admin', (req, res) => {
    res.send('全局后台已移至 /admin.html?key=xxx 访问');
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`注册页面: http://localhost:${PORT}/register.html`);
    console.log(`合伙人后台: http://localhost:${PORT}/partner.html`);
    console.log(`管理员后台: http://localhost:${PORT}/admin.html?key=${ADMIN_KEY}`);
});