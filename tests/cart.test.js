const { app, request, getAdminToken, registerUser } = require('./setup');

describe('Cart API', () => {
  const sessionId = 'test-session-' + Date.now();
  let productId;
  let cartItemId;
  let userToken;

  beforeAll(async () => {
    // Get a product id from the product list
    const res = await request(app).get('/api/products');
    productId = res.body.data.products[0].id;
  });

  it('should add product to cart (guest mode)', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('X-Session-Id', sessionId)
      .send({ productId, quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('product_id', productId);
    expect(res.body.data).toHaveProperty('quantity');

    cartItemId = res.body.data.id;
  });

  it('should get cart (guest mode)', async () => {
    const res = await request(app)
      .get('/api/cart')
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('total');
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it('should update cart item quantity (guest mode)', async () => {
    const res = await request(app)
      .patch(`/api/cart/${cartItemId}`)
      .set('X-Session-Id', sessionId)
      .send({ quantity: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('quantity', 3);
  });

  it('should remove cart item (guest mode)', async () => {
    const res = await request(app)
      .delete(`/api/cart/${cartItemId}`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);

    // Verify cart is empty
    const cartRes = await request(app)
      .get('/api/cart')
      .set('X-Session-Id', sessionId);
    expect(cartRes.body.data.items.length).toBe(0);
  });

  it('should add product to cart (authenticated mode)', async () => {
    const { token } = await registerUser();
    userToken = token;

    const res = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('product_id', productId);
  });

  it('should fail to add non-existent product to cart', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('X-Session-Id', sessionId)
      .send({ productId: 'non-existent-product-id', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toBeNull();
  });

  it('should reject non-integer quantity', async () => {
    for (const quantity of [1.9, '3abc', [5]]) {
      const res = await request(app)
        .post('/api/cart')
        .set('X-Session-Id', sessionId)
        .send({ productId, quantity });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('data', null);
      expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
    }
  });

  it('should merge the guest cart into the member cart on login', async () => {
    const guestSessionId = 'merge-login-' + Date.now();
    const email = `merge-${Date.now()}@example.com`;
    const { token } = await registerUser({ email });

    // Member already has 1; as a guest they add 2 more of the same product
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: 1 });
    await request(app)
      .post('/api/cart')
      .set('X-Session-Id', guestSessionId)
      .send({ productId, quantity: 2 });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Session-Id', guestSessionId)
      .send({ email, password: 'password123' });
    expect(loginRes.status).toBe(200);

    const memberCart = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${loginRes.body.data.token}`);
    const merged = memberCart.body.data.items.filter(item => item.product_id === productId);
    expect(merged.length).toBe(1);
    expect(merged[0]).toHaveProperty('quantity', 3);

    const guestCart = await request(app)
      .get('/api/cart')
      .set('X-Session-Id', guestSessionId);
    expect(guestCart.body.data.items.length).toBe(0);
  });

  it('should merge the guest cart on register and cap quantity at stock', async () => {
    const adminToken = await getAdminToken();
    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '合併測試花束', price: 500, stock: 3 });
    const limitedProductId = productRes.body.data.id;

    const guestSessionId = 'merge-register-' + Date.now();
    await request(app)
      .post('/api/cart')
      .set('X-Session-Id', guestSessionId)
      .send({ productId: limitedProductId, quantity: 3 });

    // Stock drops after the guest added the item
    await request(app)
      .put(`/api/admin/products/${limitedProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stock: 2 });

    const registerRes = await request(app)
      .post('/api/auth/register')
      .set('X-Session-Id', guestSessionId)
      .send({ email: `merge-register-${Date.now()}@example.com`, password: 'password123', name: '合併測試' });
    expect(registerRes.status).toBe(201);

    const memberCart = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${registerRes.body.data.token}`);
    expect(memberCart.body.data.items.length).toBe(1);
    expect(memberCart.body.data.items[0]).toHaveProperty('product_id', limitedProductId);
    expect(memberCart.body.data.items[0]).toHaveProperty('quantity', 2);
  });
});

describe('Cart PATCH validation and ownership', () => {
  let adminToken;
  let productId;
  let ownerToken;
  let otherToken;
  let itemId;

  const asOwner = req => req.set('Authorization', `Bearer ${ownerToken}`);

  async function getOwnerItemQuantity() {
    const res = await asOwner(request(app).get('/api/cart'));
    return res.body.data.items.find(item => item.id === itemId)?.quantity;
  }

  beforeAll(async () => {
    adminToken = await getAdminToken();
    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '數量驗證花束', price: 500, stock: 5 });
    productId = productRes.body.data.id;

    ownerToken = (await registerUser()).token;
    otherToken = (await registerUser()).token;

    const addRes = await asOwner(request(app).post('/api/cart')).send({ productId, quantity: 1 });
    itemId = addRes.body.data.id;
  });

  // 0 與負數過去會變成 500；小數會以 REAL 寫入並讓訂單金額失真
  it.each([
    [0],
    [-3],
    [1.5],
    [0.0625],
    ['1e2'],
    ['0x10'],
    ['abc'],
    [''],
    [null],
    [false],
    [true],
    [[5]],
    [{}]
  ])('PATCH 拒絕非正整數 quantity：%j', async quantity => {
    const res = await asOwner(request(app).patch(`/api/cart/${itemId}`)).send({ quantity });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
    expect(await getOwnerItemQuantity()).toBe(1);
  });

  it('PATCH 缺少 quantity 時回 400 VALIDATION_ERROR', async () => {
    const res = await asOwner(request(app).patch(`/api/cart/${itemId}`)).send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
  });

  it('PATCH 超過庫存回 400 STOCK_INSUFFICIENT，剛好等於庫存則成功', async () => {
    const over = await asOwner(request(app).patch(`/api/cart/${itemId}`)).send({ quantity: 6 });
    expect(over.status).toBe(400);
    expect(over.body).toHaveProperty('error', 'STOCK_INSUFFICIENT');
    expect(await getOwnerItemQuantity()).toBe(1);

    const exact = await asOwner(request(app).patch(`/api/cart/${itemId}`)).send({ quantity: 5 });
    expect(exact.status).toBe(200);
    expect(exact.body.data).toHaveProperty('quantity', 5);
    expect(await getOwnerItemQuantity()).toBe(5);
  });

  it('其他會員或訪客不能修改、刪除別人的購物車項目', async () => {
    const attempts = [
      request(app).patch(`/api/cart/${itemId}`).set('Authorization', `Bearer ${otherToken}`).send({ quantity: 2 }),
      request(app).delete(`/api/cart/${itemId}`).set('Authorization', `Bearer ${otherToken}`),
      request(app).patch(`/api/cart/${itemId}`).set('X-Session-Id', 'someone-else').send({ quantity: 2 }),
      request(app).delete(`/api/cart/${itemId}`).set('X-Session-Id', 'someone-else')
    ];

    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('data', null);
      expect(res.body).toHaveProperty('error', 'NOT_FOUND');
    }
    expect(await getOwnerItemQuantity()).toBe(5);
  });

  it('沒有任何身分資訊時 PATCH／DELETE 回 401', async () => {
    const patchRes = await request(app).patch(`/api/cart/${itemId}`).send({ quantity: 2 });
    const deleteRes = await request(app).delete(`/api/cart/${itemId}`);

    expect(patchRes.status).toBe(401);
    expect(deleteRes.status).toBe(401);
    expect(patchRes.body).toHaveProperty('data', null);
  });

  it('PATCH／DELETE 不存在的項目回 404', async () => {
    const patchRes = await asOwner(request(app).patch('/api/cart/not-an-item')).send({ quantity: 1 });
    const deleteRes = await asOwner(request(app).delete('/api/cart/not-an-item'));

    expect(patchRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
  });
});
