const { app, request, getAdminToken, registerUser } = require('./setup');
const db = require('../src/database');

const BASE_ORDER = {
  recipientName: '測試收件人',
  recipientEmail: 'recipient@example.com',
  recipientAddress: '台北市測試路 123 號',
  shippingMethod: 'home_delivery',
  isRemoteArea: false,
  isExpress: false,
};

describe('Orders API', () => {
  let userToken;
  let userId;
  let otherToken;
  let adminToken;
  let productId;
  let productPrice;
  let orderId;

  const auth = token => ({ Authorization: `Bearer ${token}` });

  async function createProduct(name, price, stock = 20) {
    const res = await request(app)
      .post('/api/admin/products')
      .set(auth(adminToken))
      .send({ name, price, stock });
    return res.body.data.id;
  }

  async function addToCart(token, id, quantity = 1) {
    return request(app).post('/api/cart').set(auth(token)).send({ productId: id, quantity });
  }

  async function placeOrder(token, overrides = {}) {
    return request(app).post('/api/orders').set(auth(token)).send({ ...BASE_ORDER, ...overrides });
  }

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Register a user for order tests
    const { token, user } = await registerUser();
    userToken = token;
    userId = user.id;
    otherToken = (await registerUser()).token;

    // 固定使用「迷你多肉組合盆」（價格 580），期望金額才能直接寫死，不用實作公式推算
    const prodRes = await request(app).get('/api/products?limit=100');
    const product = prodRes.body.data.products.find(p => p.name === '迷你多肉組合盆');
    productId = product.id;
    productPrice = product.price;

    // Add product to cart
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 1 });
  });

  it('should create an order from cart', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: '測試收件人',
        recipientEmail: 'recipient@example.com',
        recipientAddress: '台北市測試路 123 號',
        shippingMethod: 'convenience_store',
        isRemoteArea: true,
        isExpress: true,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('order_no');
    // 580 元未達免運門檻：超商基本運費 60 + 偏遠 200 + 急件 250 = 510，總額 1,090
    expect(productPrice).toBe(580);
    expect(res.body.data).toHaveProperty('subtotal', 580);
    expect(res.body.data).toHaveProperty('shipping_fee', 510);
    expect(res.body.data).toHaveProperty('shipping_method', 'convenience_store');
    expect(res.body.data).toHaveProperty('is_remote_area', true);
    expect(res.body.data).toHaveProperty('is_express', true);
    expect(res.body.data).toHaveProperty('total_amount', 1090);
    expect(res.body.data).toHaveProperty('status', 'pending');
    expect(res.body.data).toHaveProperty('items');
    expect(Array.isArray(res.body.data.items)).toBe(true);

    orderId = res.body.data.id;
  });

  it('should fail to create order with empty cart', async () => {
    // The cart was already cleared by the previous order
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: '測試收件人',
        recipientEmail: 'recipient@example.com',
        recipientAddress: '台北市測試路 123 號',
        shippingMethod: 'home_delivery',
        isRemoteArea: false,
        isExpress: false,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'CART_EMPTY');
  });

  it('should fail to create order without auth', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        recipientName: '測試收件人',
        recipientEmail: 'recipient@example.com',
        recipientAddress: '台北市測試路 123 號',
      });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toBeNull();
  });

  it('should get order list', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('orders');
    expect(Array.isArray(res.body.data.orders)).toBe(true);
    expect(res.body.data.orders.length).toBeGreaterThan(0);
  });

  it('should get order detail', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('id', orderId);
    expect(res.body.data).toHaveProperty('order_no');
    expect(res.body.data).toHaveProperty('subtotal', 580);
    expect(res.body.data).toHaveProperty('shipping_fee', 510);
    expect(res.body.data).toHaveProperty('shipping_method', 'convenience_store');
    expect(res.body.data).toHaveProperty('is_remote_area', true);
    expect(res.body.data).toHaveProperty('is_express', true);
    expect(res.body.data).toHaveProperty('total_amount', 1090);
    expect(res.body.data).toHaveProperty('items');
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('should return 404 for non-existent order', async () => {
    const res = await request(app)
      .get('/api/orders/non-existent-order-id')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error');
  });

  it("should not let another member read someone else's order", async () => {
    const res = await request(app).get(`/api/orders/${orderId}`).set(auth(otherToken));

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(BASE_ORDER.recipientAddress);
  });

  it("should not let another member pay or check someone else's order", async () => {
    const payRes = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set(auth(otherToken))
      .send({ action: 'success' });
    const checkRes = await request(app)
      .post(`/api/orders/${orderId}/check-payment`)
      .set(auth(otherToken));

    expect(payRes.status).toBe(404);
    expect(checkRes.status).toBe(404);

    const own = await request(app).get(`/api/orders/${orderId}`).set(auth(userToken));
    expect(own.body.data).toHaveProperty('status', 'pending');
  });

  it('should only list the current member\'s own orders', async () => {
    const res = await request(app).get('/api/orders').set(auth(otherToken));

    expect(res.status).toBe(200);
    expect(res.body.data.orders.map(order => order.id)).not.toContain(orderId);
  });

  it('should reject invalid mock payment actions, including prototype keys', async () => {
    for (const action of ['constructor', '__proto__', 'toString', 'unknown', '', 123, null]) {
      const res = await request(app)
        .patch(`/api/orders/${orderId}/pay`)
        .set(auth(userToken))
        .send({ action });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('data', null);
      expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
    }
  });

  it('should mark an order failed on a failed mock payment and keep it terminal', async () => {
    const id = await createProduct('付款失敗測試花束', 700);
    const { token } = await registerUser();
    await addToCart(token, id, 1);
    const orderRes = await placeOrder(token);
    expect(orderRes.status).toBe(201);

    const failRes = await request(app)
      .patch(`/api/orders/${orderRes.body.data.id}/pay`)
      .set(auth(token))
      .send({ action: 'fail' });
    expect(failRes.status).toBe(200);
    expect(failRes.body.data).toHaveProperty('status', 'failed');

    const again = await request(app)
      .patch(`/api/orders/${orderRes.body.data.id}/pay`)
      .set(auth(token))
      .send({ action: 'success' });
    expect(again.status).toBe(400);
    expect(again.body).toHaveProperty('error', 'INVALID_STATUS');
  });

  // 免運門檻：商品小計 1,500 元（含）以上免基本運費
  it.each([
    [1499, 120],
    [1500, 0],
    [1501, 0]
  ])('should charge the right shipping for a %i subtotal (home delivery)', async (price, expectedFee) => {
    const id = await createProduct(`免運邊界測試花束 ${price}`, price);
    const { token } = await registerUser();
    await addToCart(token, id, 1);

    const res = await placeOrder(token);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      subtotal: price,
      shipping_fee: expectedFee,
      total_amount: price + expectedFee
    });
  });

  it.each([
    ['非法的 shippingMethod', { shippingMethod: 'drone' }],
    ['非 boolean 的 isRemoteArea', { isRemoteArea: 'true' }],
    ['非 boolean 的 isExpress', { isExpress: 1 }],
    ['格式錯誤的 Email', { recipientEmail: 'not-an-email' }],
    ['過長的收件地址', { recipientAddress: '長'.repeat(201) }]
  ])('should reject %s without touching the cart', async (_label, overrides) => {
    const { token } = await registerUser();
    await addToCart(token, productId, 1);

    const res = await placeOrder(token, overrides);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');

    const cart = await request(app).get('/api/cart').set(auth(token));
    expect(cart.body.data.items).toHaveLength(1);
  });

  it('should store trimmed recipient fields', async () => {
    const { token } = await registerUser();
    await addToCart(token, productId, 1);

    const res = await placeOrder(token, {
      recipientName: '  王小明  ',
      recipientAddress: '  台北市信義區  '
    });
    expect(res.status).toBe(201);

    const detail = await request(app).get(`/api/orders/${res.body.data.id}`).set(auth(token));
    expect(detail.body.data).toHaveProperty('recipient_name', '王小明');
    expect(detail.body.data).toHaveProperty('recipient_address', '台北市信義區');
  });

  it('should allow ordering exactly the remaining stock', async () => {
    const id = await createProduct('剛好庫存測試花束', 800, 2);
    const { token } = await registerUser();
    await addToCart(token, id, 2);

    const res = await placeOrder(token);

    expect(res.status).toBe(201);
    expect(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock).toBe(0);
  });

  it('should reject an order when stock dropped to 0 after adding to cart', async () => {
    const id = await createProduct('庫存歸零測試花束', 800, 3);
    const { token, user } = await registerUser();
    await addToCart(token, id, 1);
    await request(app)
      .put(`/api/admin/products/${id}`)
      .set(auth(adminToken))
      .send({ stock: 0 });

    const res = await placeOrder(token);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'STOCK_INSUFFICIENT');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM orders WHERE user_id = ?').get(user.id).count
    ).toBe(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cart_items WHERE user_id = ?').get(user.id).count
    ).toBe(1);
  });

  it('should refuse to price a cart that holds a non-integer quantity', async () => {
    const id = await createProduct('髒資料測試花束', 1000);
    const { token, user } = await registerUser();
    await addToCart(token, id, 1);
    // 模擬修正前遺留的髒資料：數量被寫成小數
    db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ?').run(0.5, user.id);

    const res = await placeOrder(token);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM orders WHERE user_id = ?').get(user.id).count
    ).toBe(0);
    expect(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock).toBe(20);
  });

  it.each([
    ['數字', 123],
    ['物件', {}],
    ['陣列', ['FLOWER100']],
    ['boolean', true]
  ])('should reject a %s couponCode without touching the cart', async (_label, couponCode) => {
    const id = await createProduct(`優惠碼型別測試花束 ${_label}`, 1000);
    const { token } = await registerUser();
    await addToCart(token, id, 1);

    const res = await placeOrder(token, { couponCode });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');

    const cart = await request(app).get('/api/cart').set(auth(token));
    expect(cart.body.data.items).toHaveLength(1);
  });

  it.each([
    ['null', null],
    ['空字串', ''],
    ['純空白', '   ']
  ])('should treat a %s couponCode as no coupon', async (_label, couponCode) => {
    const id = await createProduct(`未使用優惠碼測試花束 ${_label}`, 1000);
    const { token } = await registerUser();
    await addToCart(token, id, 1);

    const res = await placeOrder(token, { couponCode });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      subtotal: 1000,
      discount: 0,
      coupon_code: null,
      shipping_fee: 120,
      total_amount: 1120
    });
  });

  it('should record the coupon and expose it on order detail, order list and admin detail', async () => {
    const id = await createProduct('優惠碼記錄測試花束', 1000);
    const { token } = await registerUser();
    await addToCart(token, id, 1);

    const created = await placeOrder(token, { couponCode: 'spring10' });
    expect(created.status).toBe(201);
    // 1,000 元打 9 折折 100 元，折扣後 900 元未達免運：運費 120，總額 1,020
    expect(created.body.data).toMatchObject({
      subtotal: 1000,
      discount: 100,
      coupon_code: 'SPRING10',
      shipping_fee: 120,
      total_amount: 1020
    });

    const orderId = created.body.data.id;
    const expected = { subtotal: 1000, discount: 100, coupon_code: 'SPRING10', total_amount: 1020 };

    const detail = await request(app).get(`/api/orders/${orderId}`).set(auth(token));
    expect(detail.body.data).toMatchObject(expected);

    const list = await request(app).get('/api/orders').set(auth(token));
    expect(list.body.data.orders.find(order => order.id === orderId)).toMatchObject(expected);

    const adminDetail = await request(app).get(`/api/admin/orders/${orderId}`).set(auth(adminToken));
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data).toMatchObject(expected);
  });

  it('should reject non-string recipient fields', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: { first: '測試' },
        recipientEmail: 'recipient@example.com',
        recipientAddress: '台北市測試路 123 號',
        shippingMethod: 'home_delivery',
        isRemoteArea: false,
        isExpress: false,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
  });

  it('should hide mock payment outside the test environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = await request(app)
        .patch(`/api/orders/${orderId}/pay`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ action: 'success' });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('data', null);
      expect(res.body).toHaveProperty('error', 'NOT_FOUND');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('should mock payment once in the test environment', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'success' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('status', 'paid');

    const again = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'fail' });

    expect(again.status).toBe(400);
    expect(again.body).toHaveProperty('error', 'INVALID_STATUS');
  });
});
