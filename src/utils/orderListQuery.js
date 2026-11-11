const { parsePositiveInteger } = require('./validators');

const ORDER_STATUSES = Object.freeze(['pending', 'paid', 'failed']);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Parse and validate the query string of GET /api/orders.
 *
 * Unlike the admin order list (which silently corrects bad values), the member list
 * rejects them: an invalid status, page or limit is an error, not a fallback.
 * The only value that is adjusted is a limit above MAX_LIMIT, which is capped.
 *
 * Express may hand over arrays or objects (?page=1&page=2, ?status[]=paid); those are
 * not valid values and are rejected as well.
 *
 * Returns { value: { status, page, limit } } or { error: <message> }.
 * status is null when the list is not filtered.
 */
function parseOrderListQuery(query = {}) {
  const { status, page, limit } = query;

  if (status !== undefined && !(typeof status === 'string' && ORDER_STATUSES.includes(status))) {
    return { error: `status 必須為 ${ORDER_STATUSES.join('、')} 其中之一` };
  }

  let parsedPage = DEFAULT_PAGE;
  if (page !== undefined) {
    parsedPage = parsePositiveInteger(page);
    if (parsedPage === null) {
      return { error: 'page 必須為正整數' };
    }
  }

  let parsedLimit = DEFAULT_LIMIT;
  if (limit !== undefined) {
    parsedLimit = parsePositiveInteger(limit);
    if (parsedLimit === null) {
      return { error: 'limit 必須為正整數' };
    }
  }

  return {
    value: {
      status: status ?? null,
      page: parsedPage,
      limit: Math.min(parsedLimit, MAX_LIMIT)
    }
  };
}

module.exports = {
  ORDER_STATUSES,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseOrderListQuery
};
