const {
  ORDER_STATUSES,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseOrderListQuery
} = require('../src/utils/orderListQuery');

describe('parseOrderListQuery', () => {
  describe('預設值', () => {
    it.each([
      ['未提供 query', undefined],
      ['空物件', {}]
    ])('%s：第 1 頁、每頁 10 筆、不篩選', (_label, query) => {
      expect(parseOrderListQuery(query)).toEqual({
        value: { status: null, page: 1, limit: 10 }
      });
    });

    it('常數與規格一致', () => {
      expect(ORDER_STATUSES).toEqual(['pending', 'paid', 'failed']);
      expect(DEFAULT_PAGE).toBe(1);
      expect(DEFAULT_LIMIT).toBe(10);
      expect(MAX_LIMIT).toBe(50);
      expect(Object.isFrozen(ORDER_STATUSES)).toBe(true);
    });
  });

  describe('status', () => {
    it.each(['pending', 'paid', 'failed'])('接受 %s', status => {
      expect(parseOrderListQuery({ status })).toEqual({
        value: { status, page: 1, limit: 10 }
      });
    });

    it.each([
      ['不在允許值內', 'unknown'],
      ['大小寫不同', 'PAID'],
      ['前後有空白', ' paid '],
      ['空字串', ''],
      ['原型鍵', 'constructor'],
      ['SQL 片段', "paid' OR '1'='1"],
      ['陣列（?status=paid&status=pending）', ['paid', 'pending']],
      ['單元素陣列（?status[]=paid）', ['paid']],
      ['物件（?status[a]=b）', { a: 'b' }],
      ['數字', 1],
      ['null', null]
    ])('拒絕%s', (_label, status) => {
      const result = parseOrderListQuery({ status });

      expect(result).toHaveProperty('error', expect.stringContaining('status'));
      expect(result).not.toHaveProperty('value');
    });
  });

  describe('page', () => {
    it.each([
      ['1', 1],
      ['2', 2],
      ['010', 10],
      ['99999999999999999999', 1e20] // 合法的正整數，超過總頁數時由 service 回空陣列
    ])('接受 page=%s', (page, expected) => {
      expect(parseOrderListQuery({ page }).value.page).toBe(expected);
    });

    it.each([
      ['0', '0'],
      ['負數', '-1'],
      ['小數', '1.5'],
      ['非數字', 'abc'],
      ['空字串', ''],
      ['前後有空白', ' 2'],
      ['科學記號', '1e2'],
      ['十六進位', '0x10'],
      ['正號', '+1'],
      ['全形數字', '１'],
      ['超長數字（超出 Number 範圍）', '9'.repeat(400)],
      ['陣列（?page=1&page=2）', ['1', '2']],
      ['單元素陣列（?page[]=1）', ['1']],
      ['物件', { a: '1' }],
      ['null', null]
    ])('拒絕 page 為%s', (_label, page) => {
      expect(parseOrderListQuery({ page })).toEqual({ error: 'page 必須為正整數' });
    });
  });

  describe('limit', () => {
    it.each([
      ['1', 1],
      ['5', 5],
      ['10', 10],
      ['50', 50]
    ])('接受 limit=%s', (limit, expected) => {
      expect(parseOrderListQuery({ limit }).value.limit).toBe(expected);
    });

    it.each([
      ['51', 50],
      ['100', 50],
      ['99999999999999999999', 50]
    ])('limit=%s 超過上限，以 50 計', (limit, expected) => {
      expect(parseOrderListQuery({ limit })).toEqual({
        value: { status: null, page: 1, limit: expected }
      });
    });

    it.each([
      ['0', '0'],
      ['負數', '-1'],
      ['小數', '1.5'],
      ['非數字', 'abc'],
      ['空字串', ''],
      ['科學記號', '1e2'],
      ['超長數字（超出 Number 範圍，與 page 一致回 400）', '9'.repeat(400)],
      ['陣列', ['5', '10']],
      ['物件', { a: '5' }]
    ])('拒絕 limit 為%s', (_label, limit) => {
      expect(parseOrderListQuery({ limit })).toEqual({ error: 'limit 必須為正整數' });
    });
  });

  describe('組合', () => {
    it('三個參數同時合法', () => {
      expect(parseOrderListQuery({ status: 'paid', page: '3', limit: '5' })).toEqual({
        value: { status: 'paid', page: 3, limit: 5 }
      });
    });

    it('任一參數非法就整體拒絕，並依 status、page、limit 的順序回報第一個錯誤', () => {
      expect(parseOrderListQuery({ status: 'x', page: '0', limit: '-1' }).error).toContain('status');
      expect(parseOrderListQuery({ status: 'paid', page: '0', limit: '-1' }).error).toContain('page');
      expect(parseOrderListQuery({ status: 'paid', page: '1', limit: '-1' }).error).toContain('limit');
    });

    it('不會因輸入物件被修改而影響結果（純函式）', () => {
      const query = Object.freeze({ status: 'paid', page: '2', limit: '100' });

      expect(() => parseOrderListQuery(query)).not.toThrow();
      expect(parseOrderListQuery(query).value).toEqual({ status: 'paid', page: 2, limit: 50 });
    });
  });
});
