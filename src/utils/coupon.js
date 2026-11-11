const COUPON_TYPES = Object.freeze({
  FIXED: 'fixed',
  PERCENT: 'percent'
});

const COUPON_ERROR_REASONS = Object.freeze({
  INVALID: 'INVALID',
  EXPIRED: 'EXPIRED',
  BELOW_MINIMUM: 'BELOW_MINIMUM'
});

// 優惠碼規則表（碼一律以大寫為 key）：
// - fixed：折抵固定金額；percent：折抵 percentOff %，並以 maxDiscount 為上限
// - minSubtotal：使用門檻（商品小計需大於等於此金額）
// - expired：已失效，不可使用
const COUPON_RULES = Object.freeze({
  FLOWER100: Object.freeze({ type: COUPON_TYPES.FIXED, amount: 100, minSubtotal: 800 }),
  SPRING10: Object.freeze({ type: COUPON_TYPES.PERCENT, percentOff: 10, maxDiscount: 300 }),
  SUMMER50: Object.freeze({ type: COUPON_TYPES.FIXED, amount: 50, expired: true })
});

// 優惠碼無法使用（無效、已失效或未達門檻）；與輸入型別錯誤的 TypeError 區分
class CouponError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'CouponError';
    this.reason = reason;
  }
}

/**
 * 統一優惠碼寫法：undefined、null 與空白字串視為「未使用優惠碼」，
 * 其餘去除前後空白並轉大寫（優惠碼不分大小寫）。
 */
function normalizeCouponCode(couponCode) {
  if (couponCode === undefined || couponCode === null) {
    return null;
  }

  if (typeof couponCode !== 'string') {
    throw new TypeError('couponCode 必須為字串');
  }

  const trimmed = couponCode.trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

function calculateRuleDiscount(rule, subtotal) {
  if (rule.type === COUPON_TYPES.PERCENT) {
    // 以整數運算四捨五入（0.5 進位），避免浮點誤差，例如 1,235 × 10% = 123.5 → 124
    const rounded = Math.floor((subtotal * rule.percentOff + 50) / 100);
    return Math.min(rounded, rule.maxDiscount ?? Infinity);
  }

  return rule.amount;
}

/**
 * Apply a coupon to a product subtotal (shipping is never discounted).
 * Returns { code, discount, discountedSubtotal }; code is null when no coupon is used.
 * Throws CouponError when the coupon is unknown, expired or the subtotal is below its minimum.
 */
function applyCoupon({ subtotal, couponCode }) {
  if (!Number.isInteger(subtotal) || subtotal < 0) {
    throw new TypeError('subtotal 必須為非負整數');
  }

  const code = normalizeCouponCode(couponCode);
  if (code === null) {
    return Object.freeze({ code: null, discount: 0, discountedSubtotal: subtotal });
  }

  // hasOwn：避免 constructor、__proto__ 等原型鍵被當成有效優惠碼
  if (!Object.hasOwn(COUPON_RULES, code)) {
    throw new CouponError(COUPON_ERROR_REASONS.INVALID, '優惠碼無效');
  }

  const rule = COUPON_RULES[code];

  if (rule.expired) {
    throw new CouponError(COUPON_ERROR_REASONS.EXPIRED, '優惠碼已失效');
  }

  if (rule.minSubtotal !== undefined && subtotal < rule.minSubtotal) {
    throw new CouponError(
      COUPON_ERROR_REASONS.BELOW_MINIMUM,
      `商品小計需滿 ${rule.minSubtotal} 元才可使用此優惠碼`
    );
  }

  // 折扣不會超過商品小計，訂單總額不會因優惠碼變成負數
  const discount = Math.min(calculateRuleDiscount(rule, subtotal), subtotal);

  return Object.freeze({
    code,
    discount,
    discountedSubtotal: subtotal - discount
  });
}

module.exports = {
  COUPON_RULES,
  COUPON_ERROR_REASONS,
  CouponError,
  normalizeCouponCode,
  applyCoupon
};
