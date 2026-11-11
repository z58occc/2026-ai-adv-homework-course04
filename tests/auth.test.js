const { app, request, registerUser } = require('./setup');

describe('Auth API', () => {
  let registeredEmail;
  let userToken;

  it('should register a new user successfully', async () => {
    registeredEmail = `auth-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: registeredEmail, password: 'password123', name: '測試用戶' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user).toHaveProperty('id');
    expect(res.body.data.user).toHaveProperty('email', registeredEmail);
    expect(res.body.data.user).toHaveProperty('role', 'user');

    userToken = res.body.data.token;
  });

  it('should fail to register with duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: registeredEmail, password: 'password123', name: '重複用戶' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toBeNull();
  });

  it('should login successfully', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@hexschool.com', password: '12345678' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user).toHaveProperty('email', 'admin@hexschool.com');
  });

  it('should fail login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@hexschool.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toBeNull();
  });

  it('should get profile with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('email', registeredEmail);
    expect(res.body.data).toHaveProperty('name');
    expect(res.body.data).toHaveProperty('role');
  });

  it('should fail to get profile without token', async () => {
    const res = await request(app)
      .get('/api/auth/profile');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toBeNull();
  });

  it('should reject non-string credentials', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: registeredEmail, password: 12345678 });

    expect(loginRes.status).toBe(400);
    expect(loginRes.body).toHaveProperty('data', null);
    expect(loginRes.body).toHaveProperty('error', 'VALIDATION_ERROR');

    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: `number-${Date.now()}@example.com`, password: 12345678, name: '測試' });

    expect(registerRes.status).toBe(400);
    expect(registerRes.body).toHaveProperty('error', 'VALIDATION_ERROR');
  });

  it('should return VALIDATION_ERROR for a malformed JSON body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '請求格式錯誤'
    });
    vi.restoreAllMocks();
  });
});

describe('Token verification', () => {
  const jwt = require('jsonwebtoken');
  const db = require('../src/database');

  const signToken = (payload, secret = process.env.JWT_SECRET, options = {}) =>
    jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '1h', ...options });
  const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');

  it('role 以資料庫為準：token 自稱 admin 的一般會員不能進後台', async () => {
    const { user } = await registerUser();
    const forged = signToken({ userId: user.id, email: user.email, role: 'admin' });

    const res = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'FORBIDDEN');
  });

  it('管理員被降權後，舊 token 立刻失去後台權限', async () => {
    const { user } = await registerUser();
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password123' });
    const adminToken = loginRes.body.data.token;

    const before = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.status).toBe(200);

    db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(user.id);

    const after = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(403);
  });

  it('已刪除使用者的 token 回 401', async () => {
    const { token, user } = await registerUser();
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'UNAUTHORIZED');
  });

  it('以錯誤密鑰簽發、alg:none 或已過期的 token 皆回 401', async () => {
    const { user } = await registerUser();
    const payload = { userId: user.id, email: user.email, role: 'user' };
    const tokens = [
      signToken(payload, 'not-the-real-secret'),
      `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`,
      signToken(payload, process.env.JWT_SECRET, { expiresIn: -10 })
    ];

    for (const token of tokens) {
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'UNAUTHORIZED');
    }
  });

  it('購物車帶了無效 token 時直接回 401，不會退回 X-Session-Id', async () => {
    const res = await request(app)
      .get('/api/cart')
      .set('Authorization', 'Bearer invalid.token.value')
      .set('X-Session-Id', 'fallback-session');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'UNAUTHORIZED');
  });
});
