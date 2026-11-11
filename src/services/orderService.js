const { v4: uuidv4 } = require('uuid');
const db = require('../database');

// 扣庫存時發現庫存已不足（檢查與扣減之間被其他請求搶先）
class StockInsufficientError extends Error {
  constructor(productName) {
    super(`庫存不足：${productName}`);
    this.name = 'StockInsufficientError';
    this.productName = productName;
  }
}

function generateOrderNo() {
  // Use Taipei date so the order number matches ECPay MerchantTradeDate
  const dateStr = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
    .replace(/-/g, '');
  const random = uuidv4().slice(0, 5).toUpperCase();
  return `ORD-${dateStr}-${random}`;
}

function serializeOrder(order) {
  return {
    ...order,
    is_remote_area: Boolean(order.is_remote_area),
    is_express: Boolean(order.is_express)
  };
}

function findOrderById(orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function findOrderForUser(orderId, userId) {
  return db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
}

/**
 * One page of the member's own orders, newest first, optionally filtered by status.
 * Returns { orders, total } where total counts every order matching the filter.
 * created_at only has one-second precision, so rowid breaks ties and keeps pages stable.
 */
function listOrdersForUser(userId, { status = null, page = 1, limit = 10 } = {}) {
  // WHERE 片段只在這裡以程式內的常數字串組成，使用者輸入一律走 ? 參數
  const where = status ? 'WHERE user_id = ? AND status = ?' : 'WHERE user_id = ?';
  const params = status ? [userId, status] : [userId];

  const { count: total } = db.prepare(`SELECT COUNT(*) AS count FROM orders ${where}`).get(...params);

  // offset 已超過總筆數時不查詢，避免極大的 page 變成超出 SQLite 整數範圍的 OFFSET
  const offset = (page - 1) * limit;
  const orders = offset >= total
    ? []
    : db.prepare(
      `SELECT id, order_no, subtotal, discount, coupon_code, shipping_fee, shipping_method,
              is_remote_area, is_express, total_amount, status, created_at
       FROM orders ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

  return { orders, total };
}

function getOrderItems(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
}

function getOrderItemSummaries(orderId) {
  return db.prepare(
    'SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?'
  ).all(orderId);
}

// Cart items joined with the current product price and stock
function getCheckoutItems(userId) {
  return db.prepare(
    `SELECT ci.id, ci.product_id, ci.quantity,
            p.name as product_name, p.price as product_price, p.stock as product_stock
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = ?`
  ).all(userId);
}

function findInsufficientItems(cartItems) {
  return cartItems.filter(item => item.quantity > item.product_stock);
}

// 數量必須是正整數；小數或 0 會讓金額與庫存計算失真
function findInvalidQuantityItems(cartItems) {
  return cartItems.filter(item => !Number.isInteger(item.quantity) || item.quantity <= 0);
}

/**
 * Create an order from the member's cart in one transaction:
 * insert order → snapshot items → deduct stock → clear cart.
 * Amounts must already be calculated by the caller:
 * total_amount = shipping.totalAmount = (subtotal - discount) + shipping fee.
 */
function createOrderFromCart({
  userId,
  recipient,
  delivery,
  cartItems,
  subtotal,
  discount = 0,
  couponCode = null,
  shipping
}) {
  const orderId = uuidv4();
  const orderNo = generateOrderNo();
  const merchantTradeNo = orderNo.replace(/-/g, '');

  const insertOrder = db.prepare(
    `INSERT INTO orders (
       id, order_no, user_id, recipient_name, recipient_email, recipient_address,
       subtotal, discount, coupon_code, shipping_fee, shipping_method, is_remote_area, is_express,
       total_amount, merchant_trade_no
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  // 條件式扣庫存：庫存不足時不更新，由 changes 判斷並中止整筆 transaction
  const updateStock = db.prepare(
    'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?'
  );
  const clearCart = db.prepare('DELETE FROM cart_items WHERE user_id = ?');

  db.transaction(() => {
    insertOrder.run(
      orderId,
      orderNo,
      userId,
      recipient.name,
      recipient.email,
      recipient.address,
      subtotal,
      discount,
      couponCode,
      shipping.shippingFee,
      delivery.method,
      delivery.isRemoteArea ? 1 : 0,
      delivery.isExpress ? 1 : 0,
      shipping.totalAmount,
      merchantTradeNo
    );

    for (const item of cartItems) {
      insertItem.run(uuidv4(), orderId, item.product_id, item.product_name, item.product_price, item.quantity);
      const deducted = updateStock.run(item.quantity, item.product_id, item.quantity);
      if (deducted.changes === 0) {
        throw new StockInsufficientError(item.product_name);
      }
    }

    clearCart.run(userId);
  })();

  return orderId;
}

module.exports = {
  StockInsufficientError,
  generateOrderNo,
  serializeOrder,
  findOrderById,
  findOrderForUser,
  listOrdersForUser,
  getOrderItems,
  getOrderItemSummaries,
  getCheckoutItems,
  findInsufficientItems,
  findInvalidQuantityItems,
  createOrderFromCart
};
