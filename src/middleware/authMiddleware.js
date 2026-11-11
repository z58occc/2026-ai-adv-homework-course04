const jwt = require('jsonwebtoken');
const db = require('../database');

const TOKEN_ERRORS = Object.freeze({
  INVALID_TOKEN: 'Token 無效或已過期',
  USER_NOT_FOUND: '使用者不存在，請重新登入'
});

/**
 * Verify a JWT and load the current user from the database.
 * email 與 role 以資料庫為準，不信任 token 內的內容，
 * 這樣被降權或刪除的帳號，舊 token 會立刻失效。
 * Returns { user } on success or { error } (a TOKEN_ERRORS key) on failure.
 */
function resolveUserFromToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return { error: 'INVALID_TOKEN' };
  }

  const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(decoded.userId);
  if (!user) {
    return { error: 'USER_NOT_FOUND' };
  }

  return { user: { userId: user.id, email: user.email, role: user.role } };
}

function unauthorized(res, errorKey) {
  return res.status(401).json({
    data: null,
    error: 'UNAUTHORIZED',
    message: TOKEN_ERRORS[errorKey]
  });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      data: null,
      error: 'UNAUTHORIZED',
      message: '請先登入'
    });
  }

  const { user, error } = resolveUserFromToken(authHeader.split(' ')[1]);
  if (error) {
    return unauthorized(res, error);
  }

  req.user = user;
  next();
}

module.exports = authMiddleware;
module.exports.resolveUserFromToken = resolveUserFromToken;
module.exports.unauthorized = unauthorized;
