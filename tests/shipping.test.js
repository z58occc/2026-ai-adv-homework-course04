const {
  SHIPPING_METHODS,
  calculateShipping
} = require('../src/utils/shipping');

const { HOME_DELIVERY, CONVENIENCE_STORE } = SHIPPING_METHODS;

describe('Shipping module', () => {
  describe('基本運費', () => {
    it.each([
      ['宅配', HOME_DELIVERY, 120],
      ['超商取貨', CONVENIENCE_STORE, 60]
    ])('%s基本運費 %i 元', (_label, method, expectedFee) => {
      const result = calculateShipping({ subtotal: 1000, method });

      expect(result.shippingFee).toBe(expectedFee);
      expect(result.totalAmount).toBe(1000 + expectedFee);
    });
  });

  describe('滿額免基本運費', () => {
    // 門檻邊界：1,499 收費、1,500 剛好免運、1,501 免運；兩種配送方式各驗一次
    // 欄位順序配合標題的 %s %i %s %i，method 放最後不參與標題
    it.each([
      ['宅配', 0, false, 120, HOME_DELIVERY],
      ['宅配', 1499, false, 120, HOME_DELIVERY],
      ['宅配', 1500, true, 0, HOME_DELIVERY],
      ['宅配', 1501, true, 0, HOME_DELIVERY],
      ['超商取貨', 1499, false, 60, CONVENIENCE_STORE],
      ['超商取貨', 1500, true, 0, CONVENIENCE_STORE],
      ['超商取貨', 1501, true, 0, CONVENIENCE_STORE]
    ])('%s商品小計 %i 元：免運 %s、運費 %i 元', (_label, subtotal, expectedFree, expectedFee, method) => {
      const result = calculateShipping({ subtotal, method });

      expect(result.qualifiesForFreeShipping).toBe(expectedFree);
      expect(result.shippingFee).toBe(expectedFee);
      expect(result.totalAmount).toBe(subtotal + expectedFee);
    });

    it('商品小計剛好 1,500 元時免基本運費，但仍收附加費', () => {
      const result = calculateShipping({
        subtotal: 1500,
        method: HOME_DELIVERY,
        isRemoteArea: true,
        isExpress: true
      });

      expect(result.baseFee).toBe(0);
      expect(result.shippingFee).toBe(450);
      expect(result.totalAmount).toBe(1950);
    });

    it.each([
      ['宅配', HOME_DELIVERY],
      ['超商取貨', CONVENIENCE_STORE]
    ])('商品小計 2,000 元時，%s免基本運費', (_label, method) => {
      const result = calculateShipping({ subtotal: 2000, method });

      expect(result.qualifiesForFreeShipping).toBe(true);
      expect(result.baseFee).toBe(0);
      expect(result.shippingFee).toBe(0);
    });
  });

  describe('附加費', () => {
    it.each([
      ['偏遠地區', { isRemoteArea: true }, 'remoteAreaSurcharge', 200, 320],
      ['當日急件', { isExpress: true }, 'expressSurcharge', 250, 370]
    ])('加收%s附加費', (_label, options, field, surcharge, expectedFee) => {
      const result = calculateShipping({ subtotal: 1000, method: HOME_DELIVERY, ...options });

      expect(result[field]).toBe(surcharge);
      expect(result.shippingFee).toBe(expectedFee);
    });

    it('同時加收偏遠地區與當日急件附加費', () => {
      const result = calculateShipping({
        subtotal: 1000,
        method: HOME_DELIVERY,
        isRemoteArea: true,
        isExpress: true
      });

      expect(result.shippingFee).toBe(570);
    });

    it('滿額免基本運費時仍收所有附加費', () => {
      const result = calculateShipping({
        subtotal: 2000,
        method: HOME_DELIVERY,
        isRemoteArea: true,
        isExpress: true
      });

      expect(result.baseFee).toBe(0);
      expect(result.shippingFee).toBe(450);
      expect(result.totalAmount).toBe(2450);
    });
  });

  describe('輸入驗證', () => {
    it.each([
      ['負數小計', { subtotal: -1, method: HOME_DELIVERY }],
      ['小數小計', { subtotal: 1499.5, method: HOME_DELIVERY }],
      ['非數字小計', { subtotal: '1500', method: HOME_DELIVERY }],
      ['NaN 小計', { subtotal: NaN, method: HOME_DELIVERY }],
      ['不支援的配送方式', { subtotal: 1000, method: 'drone' }],
      ['非 boolean 的條件旗標', { subtotal: 1000, method: HOME_DELIVERY, isRemoteArea: 1 }]
    ])('拒絕%s', (_label, input) => {
      expect(() => calculateShipping(input)).toThrow(TypeError);
    });
  });
});
