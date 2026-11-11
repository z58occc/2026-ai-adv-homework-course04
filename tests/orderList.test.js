const { app, request, getAdminToken, registerUser } = require('./setup');

const BASE_ORDER = {
  recipientName: '訂單列表測試收件人',
  recipientEmail: 'order-list@example.com',
  recipientAddress: '台北市測試路 1 號',
  shippingMethod: 'home_delivery',
  isRemoteArea: false,
  isExpress: false,
};

describe('GET /api/orders：篩選與分頁', () => {
  let productId;

  const auth = token => ({ Authorization: `Bearer ${token}` });
  const list = (token, query = '') => request(app).get(`/api/orders${query}`).set(auth(token));

  // 依序建立 count 筆訂單，回傳依建立順序（舊到新）排列的訂單 id
  async function createOrders(token, count) {
    const ids = [];
    for (let i = 0; i < count; i += 1) {
      await request(app).post('/api/cart').set(auth(token)).send({ productId, quantity: 1 });
      const res = await request(app).post('/api/orders').set(auth(token)).send(BASE_ORDER);
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }
    return ids;
  }

  const setStatus = (token, orderId, action) =>
    request(app).patch(`/api/orders/${orderId}/pay`).set(auth(token)).send({ action });

  beforeAll(async () => {
    const adminToken = await getAdminToken();
    const res = await request(app)
      .post('/api/admin/products')
      .set(auth(adminToken))
      .send({ name: '訂單列表測試花束', price: 100, stock: 500 });
    productId = res.body.data.id;
  });

  it('沒有任何訂單時回傳空陣列與 total 0、totalPages 0', async () => {
    const { token } = await registerUser();

    const res = await list(token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ error: null });
    expect(res.body.data.orders).toEqual([]);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it('不帶參數：第 1 頁、每頁 10 筆，pagination 格式與後台列表一致', async () => {
    const { token } = await registerUser();
    await createOrders(token, 12);

    const res = await list(token);

    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(10);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 10, total: 12, totalPages: 2 });
    expect(Object.keys(res.body.data).sort()).toEqual(['orders', 'pagination']);
  });

  it('列表欄位維持原本的內容（含布林欄位與優惠碼欄位），不含收件人個資', async () => {
    const { token } = await registerUser();
    await createOrders(token, 1);

    const res = await list(token);

    const [order] = res.body.data.orders;
    expect(Object.keys(order).sort()).toEqual([
      'coupon_code', 'created_at', 'discount', 'id', 'is_express', 'is_remote_area', 'order_no',
      'shipping_fee', 'shipping_method', 'status', 'subtotal', 'total_amount'
    ]);
    expect(order).toMatchObject({ is_remote_area: false, is_express: false, status: 'pending' });
  });

  it('依建立時間由新到舊：連續快速建立的訂單以建立先後排序', async () => {
    const { token } = await registerUser();
    const created = await createOrders(token, 6);

    const res = await list(token);

    expect(res.body.data.orders.map(order => order.id)).toEqual([...created].reverse());
  });

  it('逐頁取回：每筆訂單剛好出現一次，不重複、不遺漏，順序為新到舊', async () => {
    const { token } = await registerUser();
    const created = await createOrders(token, 12);

    const pages = [];
    for (const page of [1, 2, 3]) {
      const res = await list(token, `?page=${page}&limit=5`);
      expect(res.status).toBe(200);
      pages.push(res.body.data);
    }

    expect(pages.map(data => data.orders.length)).toEqual([5, 5, 2]);
    expect(pages.every(data => data.pagination.total === 12 && data.pagination.totalPages === 3)).toBe(true);
    expect(pages.flatMap(data => data.orders.map(order => order.id))).toEqual([...created].reverse());
  });

  it('12 筆、limit=5 時，第 3 頁有 2 筆，totalPages 為 3', async () => {
    const { token } = await registerUser();
    await createOrders(token, 12);

    const res = await list(token, '?page=3&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(2);
    expect(res.body.data.pagination).toEqual({ page: 3, limit: 5, total: 12, totalPages: 3 });
  });

  it('依 status 篩選，total 與 totalPages 以篩選後的數量計算，並可搭配分頁', async () => {
    const { token } = await registerUser();
    const ids = await createOrders(token, 7);
    // 0、1、2 付款成功；3 付款失敗；4、5、6 維持 pending
    for (const id of ids.slice(0, 3)) {
      expect((await setStatus(token, id, 'success')).status).toBe(200);
    }
    expect((await setStatus(token, ids[3], 'fail')).status).toBe(200);

    const paid = await list(token, '?status=paid');
    expect(paid.body.data.orders.map(order => order.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(paid.body.data.pagination).toEqual({ page: 1, limit: 10, total: 3, totalPages: 1 });

    const failed = await list(token, '?status=failed');
    expect(failed.body.data.orders.map(order => order.id)).toEqual([ids[3]]);

    const pendingPage2 = await list(token, '?status=pending&page=2&limit=2');
    expect(pendingPage2.body.data.orders.map(order => order.id)).toEqual([ids[4]]);
    expect(pendingPage2.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });

    const all = await list(token);
    expect(all.body.data.pagination.total).toBe(7);
  });

  it('limit 超過 50 時以 50 計；剛好 50 維持 50', async () => {
    const { token } = await registerUser();

    for (const [query, expected] of [['?limit=100', 50], ['?limit=51', 50], ['?limit=50', 50], ['?limit=49', 49]]) {
      const res = await list(token, query);
      expect(res.status).toBe(200);
      expect(res.body.data.pagination.limit).toBe(expected);
    }
  });

  it('page 超過總頁數：回 200 與空陣列，包含極大的 page（不可因 OFFSET 溢位回 500）', async () => {
    const { token } = await registerUser();
    await createOrders(token, 2);

    for (const page of ['3', '1000000', '99999999999999999999']) {
      const res = await list(token, `?page=${page}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toEqual([]);
      expect(res.body.data.pagination).toMatchObject({ limit: 10, total: 2, totalPages: 1 });
    }
  });

  // 與後台列表不同：非法值回 400，不自動修正
  it.each([
    ['status 不在允許值內', '?status=unknown'],
    ['status 大小寫不同', '?status=PAID'],
    ['status 為空字串', '?status='],
    ['status 重複（陣列）', '?status=paid&status=pending'],
    ['status[] 陣列', '?status[]=paid'],
    ['status 為物件', '?status[a]=b'],
    ['status 夾帶 SQL', `?status=${encodeURIComponent("paid' OR '1'='1")}`],
    ['page=0', '?page=0'],
    ['page 為負數', '?page=-1'],
    ['page 為小數', '?page=1.5'],
    ['page 不是數字', '?page=abc'],
    ['page 為空字串', '?page='],
    ['page 重複（陣列）', '?page=1&page=2'],
    ['page[] 陣列', '?page[]=1'],
    ['page 為科學記號', '?page=1e2'],
    ['page 為十六進位', '?page=0x10'],
    ['page 為超長數字', `?page=${'9'.repeat(400)}`],
    ['limit=0', '?limit=0'],
    ['limit 為負數', '?limit=-1'],
    ['limit 為小數', '?limit=1.5'],
    ['limit 不是數字', '?limit=abc'],
    ['limit 為空字串', '?limit='],
    ['limit 重複（陣列）', '?limit=5&limit=10'],
    ['合法的 status 搭配非法的 page', '?status=paid&page=0']
  ])('回 400：%s', async (_label, query) => {
    const { token } = await registerUser();
    await createOrders(token, 1);

    const res = await list(token, query);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ data: null, error: 'VALIDATION_ERROR' });
    expect(res.body.message).toEqual(expect.any(String));
  });

  it('只回傳自己的訂單：不論有沒有篩選或分頁，都不會出現其他會員的訂單', async () => {
    const mine = await registerUser();
    const others = await registerUser();
    const myIds = await createOrders(mine.token, 3);
    const otherIds = await createOrders(others.token, 5);
    await setStatus(mine.token, myIds[0], 'success');
    await setStatus(others.token, otherIds[0], 'success');

    const all = await list(mine.token, '?limit=50');
    expect(all.body.data.pagination.total).toBe(3);
    expect(all.body.data.orders.map(order => order.id).sort()).toEqual([...myIds].sort());

    const paid = await list(mine.token, '?status=paid');
    expect(paid.body.data.orders.map(order => order.id)).toEqual([myIds[0]]);
    expect(paid.body.data.pagination.total).toBe(1);

    const theirs = await list(others.token);
    expect(theirs.body.data.orders.every(order => otherIds.includes(order.id))).toBe(true);
  });

  it('沒有登入時回 401，不論 query 是否合法', async () => {
    for (const query of ['', '?status=paid', '?page=0']) {
      const res = await request(app).get(`/api/orders${query}`);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ data: null, error: 'UNAUTHORIZED' });
    }
  });
});
