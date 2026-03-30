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
                    button { cursor: pointer; padding: 4px 8px; margin: 0 2px; border: none; border-radius: 6px; }
                    .edit-btn { background: #2a86d4; color: white; }
                    .delete-btn { background: #dc3545; color: white; }
                    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center; }
                    .modal-content { background: white; width: 90%; max-width: 500px; border-radius: 16px; padding: 20px; }
                    .modal-content input { width: 100%; margin-bottom: 12px; padding: 8px; border-radius: 8px; border: 1px solid #ccc; }
                    .modal-buttons { text-align: right; margin-top: 16px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>📊 保险合伙人潜力测评统计</h1>
                    <p>共 ${rows.length} 条记录</p>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th><th>姓名</th><th>手机号</th><th>总分</th>
                                <th>等级</th><th>标题</th><th>微信号配置</th><th>IP</th><th>时间</th><th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        for (const row of rows) {
            html += `
                <tr data-id="${row.id}">
                    <td>${row.id}</td>
                    <td class="name">${escapeHtml(row.name)}</td>
                    <td class="phone">${escapeHtml(row.phone)}</td>
                    <td>${row.total_score}</td>
                    <td>${escapeHtml(row.level)}</td>
                    <td>${escapeHtml(row.title)}</td>
                    <td>${escapeHtml(row.wechat_config)}</td>
                    <td>${escapeHtml(row.ip)}</td>
                    <td>${row.created_at}</td>
                    <td>
                        <button class="edit-btn" data-id="${row.id}">编辑</button>
                        <button class="delete-btn" data-id="${row.id}">删除</button>
                    </td>
                </tr>
            `;
        }
        html += `
                        </tbody>
                    </table>
                </div>
                <div id="editModal" class="modal">
                    <div class="modal-content">
                        <h3>编辑记录</h3>
                        <input type="text" id="editName" placeholder="姓名">
                        <input type="tel" id="editPhone" placeholder="手机号">
                        <input type="number" id="editScore" placeholder="总分">
                        <input type="text" id="editLevel" placeholder="等级">
                        <input type="text" id="editTitle" placeholder="标题">
                        <input type="text" id="editWechat" placeholder="微信号配置">
                        <div class="modal-buttons">
                            <button id="saveEditBtn">保存</button>
                            <button id="closeModalBtn">取消</button>
                        </div>
                    </div>
                </div>
                <script>
                    const modal = document.getElementById('editModal');
                    let currentId = null;

                    document.querySelectorAll('.edit-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const row = btn.closest('tr');
                            currentId = btn.dataset.id;
                            document.getElementById('editName').value = row.querySelector('.name').innerText;
                            document.getElementById('editPhone').value = row.querySelector('.phone').innerText;
                            document.getElementById('editScore').value = row.cells[3].innerText;
                            document.getElementById('editLevel').value = row.cells[4].innerText;
                            document.getElementById('editTitle').value = row.cells[5].innerText;
                            document.getElementById('editWechat').value = row.cells[6].innerText;
                            modal.style.display = 'flex';
                        });
                    });

                    document.getElementById('saveEditBtn').addEventListener('click', async () => {
                        const data = {
                            name: document.getElementById('editName').value,
                            phone: document.getElementById('editPhone').value,
                            totalScore: parseInt(document.getElementById('editScore').value),
                            level: document.getElementById('editLevel').value,
                            title: document.getElementById('editTitle').value,
                            wechatConfig: document.getElementById('editWechat').value
                        };
                        const res = await fetch('/api/records/' + currentId, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data)
                        });
                        if (res.ok) location.reload();
                        else alert('更新失败');
                    });

                    document.querySelectorAll('.delete-btn').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (confirm('确定删除该记录吗？')) {
                                const res = await fetch('/api/records/' + btn.dataset.id, { method: 'DELETE' });
                                if (res.ok) location.reload();
                                else alert('删除失败');
                            }
                        });
                    });

                    document.getElementById('closeModalBtn').addEventListener('click', () => {
                        modal.style.display = 'none';
                    });
                </script>
            </body>
            </html>
        `;
        res.send(html);
    } catch (err) {
        console.error('查询失败:', err);
        res.status(500).send('数据库查询失败：' + err.message);
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