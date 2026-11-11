const {
  COUPON_RULES,
  COUPON_ERROR_REASONS,
  CouponError,
  normalizeCouponCode,
  applyCoupon
} = require('../src/utils/coupon');
const { SHIPPING_METHODS, calculateShipping } = require('../src/utils/shipping');

// 回傳 applyCoupon 丟出的 CouponError，沒丟錯則讓測試失敗
function couponErrorFor(input) {
  try {
    applyCoupon(input);
  } catch (err) {
    expect(err).toBeInstanceOf(CouponError);
    return err;
  }
  throw new Error('預期 applyCoupon 丟出 CouponError，但沒有');
}

describe('Coupon module', () => {
  describe('未使用優惠碼', () => {
    it.each([
      ['未帶', undefined],
      ['null', null],
      ['空字串', ''],
      ['純空白', '   ']
    ])('%s：折扣為 0，金額不變', (_label, couponCode) => {
      expect(applyCoupon({ subtotal: 1234, couponCode })).toEqual({
        code: null,
        discount: 0,
        discountedSubtotal: 1234
      });
    });
  });

  describe('FLOWER100：折抵 100 元，商品小計滿 800 元', () => {
    it.each([
      [800, 100, 700],
      [801, 100, 701],
      [1600, 100, 1500],
      [100000, 100, 99900]
    ])('商品小計 %i 元：折抵 %i 元、折扣後 %i 元', (subtotal, discount, discountedSubtotal) => {
      expect(applyCoupon({ subtotal, couponCode: 'FLOWER100' })).toEqual({
        code: 'FLOWER100',
        discount,
        discountedSubtotal
      });
    });

    it.each([[0], [1], [799]])('商品小計 %i 元未達門檻，丟出 BELOW_MINIMUM', subtotal => {
      const err = couponErrorFor({ subtotal, couponCode: 'FLOWER100' });

      expect(err.reason).toBe(COUPON_ERROR_REASONS.BELOW_MINIMUM);
      expect(err.message).toContain('800');
    });
  });

  describe('SPRING10：打 9 折（折抵 10%，四捨五入至整數），最多折抵 300 元，無門檻', () => {
    it.each([
      [0, 0],
      [4, 0], // 0.4 → 0
      [5, 1], // 0.5 → 1（四捨五入，0.5 進位）
      [14, 1], // 1.4 → 1
      [15, 2], // 1.5 → 2
      [1000, 100],
      [1234, 123], // 123.4 → 123
      [1235, 124], // 123.5 → 124，不可因浮點誤差變成 123
      [2995, 300], // 299.5 → 300，剛好碰到上限
      [3000, 300],
      [3001, 300], // 300.1 → 300
      [3500, 300], // 350 → 受上限限制
      [1000000, 300]
    ])('商品小計 %i 元：折抵 %i 元', (subtotal, expectedDiscount) => {
      expect(applyCoupon({ subtotal, couponCode: 'SPRING10' })).toEqual({
        code: 'SPRING10',
        discount: expectedDiscount,
        discountedSubtotal: subtotal - expectedDiscount
      });
    });
  });

  describe('SUMMER50：已失效', () => {
    it.each([[1], [1000], [100000]])('商品小計 %i 元仍不可使用，丟出 EXPIRED', subtotal => {
      const err = couponErrorFor({ subtotal, couponCode: 'SUMMER50' });

      expect(err.reason).toBe(COUPON_ERROR_REASONS.EXPIRED);
    });
  });

  describe('優惠碼寫法', () => {
    it.each([
      ['全小寫', 'flower100'],
      ['大小寫混合', 'FlOwEr100'],
      ['前後空白', '  FLOWER100  '],
      ['前後換行與 tab', '\tflower100\n']
    ])('%s 視為同一組優惠碼，並以大寫記錄', (_label, couponCode) => {
      expect(applyCoupon({ subtotal: 800, couponCode })).toMatchObject({
        code: 'FLOWER100',
        discount: 100
      });
    });

    it('normalizeCouponCode 回傳去空白後的大寫，空值回 null', () => {
      expect(normalizeCouponCode(' spring10 ')).toBe('SPRING10');
      expect(normalizeCouponCode('')).toBeNull();
      expect(normalizeCouponCode(undefined)).toBeNull();
    });
  });

  describe('無效優惠碼', () => {
    it.each([
      ['不存在的優惠碼', 'NOT-A-COUPON'],
      ['缺字', 'FLOWER'],
      ['多字', 'FLOWER1000'],
      ['中間有空白', 'FLOWER 100'],
      ['原型鍵 constructor', 'constructor'],
      ['原型鍵 __proto__', '__proto__'],
      ['原型鍵 hasOwnProperty', 'hasOwnProperty'],
      ['原型鍵 toString', 'toString']
    ])('%s：丟出 INVALID', (_label, couponCode) => {
      const err = couponErrorFor({ subtotal: 5000, couponCode });

      expect(err.reason).toBe(COUPON_ERROR_REASONS.INVALID);
    });
  });

  describe('輸入驗證', () => {
    it.each([
      ['數字', 123],
      ['物件', {}],
      ['陣列', ['FLOWER100']],
      ['boolean', true]
    ])('couponCode 為%s 時丟出 TypeError（不是 CouponError）', (_label, couponCode) => {
      expect(() => applyCoupon({ subtotal: 1000, couponCode })).toThrow(TypeError);
      expect(() => applyCoupon({ subtotal: 1000, couponCode })).not.toThrow(CouponError);
    });

    it.each([
      ['負數', -1],
      ['小數', 1000.5],
      ['字串', '1000'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['未提供', undefined]
    ])('subtotal 為%s 時丟出 TypeError', (_label, subtotal) => {
      expect(() => applyCoupon({ subtotal, couponCode: 'SPRING10' })).toThrow(TypeError);
    });
  });

  describe('規則表', () => {
    it('規則表為凍結物件，執行期間無法被改動', () => {
      expect(Object.isFrozen(COUPON_RULES)).toBe(true);
      expect(Object.isFrozen(COUPON_RULES.FLOWER100)).toBe(true);
    });

    it('折扣不會超過商品小計', () => {
      // 小額訂單搭配 SPRING10：折扣永遠不大於小計
      for (let subtotal = 0; subtotal <= 50; subtotal += 1) {
        const { discount, discountedSubtotal } = applyCoupon({ subtotal, couponCode: 'SPRING10' });

        expect(discount).toBeLessThanOrEqual(subtotal);
        expect(discountedSubtotal).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('搭配 Shipping 模組：免運門檻以折扣後的商品小計判斷，運費不打折', () => {
    const { HOME_DELIVERY } = SHIPPING_METHODS;

    function totalFor(subtotal, couponCode, options = {}) {
      const coupon = applyCoupon({ subtotal, couponCode });
      const shipping = calculateShipping({
        subtotal: coupon.discountedSubtotal,
        method: HOME_DELIVERY,
        ...options
      });
      return { coupon, shipping, total: shipping.totalAmount };
    }

    it('1,550 元使用 FLOWER100：折扣後 1,450 元，宅配仍收 120 元，總額 1,570 元', () => {
      const { shipping, total } = totalFor(1550, 'FLOWER100');

      expect(shipping.qualifiesForFreeShipping).toBe(false);
      expect(shipping.shippingFee).toBe(120);
      expect(total).toBe(1550 - 100 + 120);
    });

    it('1,600 元使用 FLOWER100：折扣後剛好 1,500 元，免基本運費，總額 1,500 元', () => {
      const { shipping, total } = totalFor(1600, 'FLOWER100');

      expect(shipping.qualifiesForFreeShipping).toBe(true);
      expect(shipping.shippingFee).toBe(0);
      expect(total).toBe(1500);
    });

    it('不使用優惠碼時，1,600 元本來就免運（與折扣後 1,500 元的結果一致）', () => {
      const { shipping, total } = totalFor(1600, undefined);

      expect(shipping.shippingFee).toBe(0);
      expect(total).toBe(1600);
    });

    it('SPRING10 折扣後掉到門檻以下會開始收運費：1,600 元折 160 元為 1,440 元', () => {
      const { coupon, shipping, total } = totalFor(1600, 'SPRING10');

      expect(coupon.discount).toBe(160);
      expect(shipping.shippingFee).toBe(120);
      expect(total).toBe(1600 - 160 + 120);
    });

    it('附加費不受優惠碼影響：折扣只作用在商品小計', () => {
      const { shipping, total } = totalFor(1000, 'SPRING10', { isRemoteArea: true, isExpress: true });

      // 折扣後 900 元未達免運：120 + 200 + 250
      expect(shipping.shippingFee).toBe(570);
      expect(total).toBe(1000 - 100 + 570);
    });
  });
});
