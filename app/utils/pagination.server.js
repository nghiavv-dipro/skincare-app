/**
 * Pagination Helper for Shopify GraphQL Cursor-based Pagination
 */

/**
 * Build pagination variables for Shopify GraphQL query
 * @param {Object} params
 * @param {string} params.cursor - Current cursor position
 * @param {string} params.direction - Direction: 'next' or 'previous'
 * @param {number} params.pageSize - Number of items per page
 * @returns {Object} GraphQL variables for pagination
 */
export function buildPaginationVariables({ cursor, direction = 'next', pageSize = 10 }) {
  const variables = {};

  if (direction === 'next') {
    variables.first = pageSize;
    variables.after = cursor || null;
    variables.last = null;
    variables.before = null;
  } else {
    variables.last = pageSize;
    variables.before = cursor || null;
    variables.first = null;
    variables.after = null;
  }

  return variables;
}

/**
 * Map UI sort field to Shopify OrderSortKeys
 * @param {string} field - UI sort field name
 * @returns {string} Shopify OrderSortKeys value
 */
export function mapSortField(field) {
  const sortMapping = {
    order_id: 'ID',
    order_date: 'CREATED_AT',
    total_price: 'TOTAL_PRICE',
    customer_name: 'CUSTOMER_NAME',
    updated_at: 'UPDATED_AT',
  };

  return sortMapping[field] || 'CREATED_AT';
}

/**
 * Build search query string for Shopify
 * Shopify supports special syntax: name:1234, customer:John, status:paid
 * @param {string} searchQuery - Raw search input from user
 * @returns {string} Formatted Shopify query string
 */
export function buildSearchQuery(searchQuery) {
  if (!searchQuery || searchQuery.trim() === '') {
    return null;
  }

  const trimmed = searchQuery.trim();

  // If query contains Shopify syntax (colon), use as-is
  if (trimmed.includes(':')) {
    return trimmed;
  }

  // Otherwise, search in multiple fields
  // Check if it's a number (order ID)
  if (/^\d+$/.test(trimmed)) {
    return `name:${trimmed}`;
  }

  // Search in customer name
  return trimmed;
}

/**
 * Extract pagination info from GraphQL response
 * @param {Object} pageInfo - GraphQL pageInfo object
 * @param {Array} edges - GraphQL edges array
 * @returns {Object} Pagination metadata
 */
export function extractPaginationInfo(pageInfo, edges) {
  return {
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage,
    startCursor: pageInfo.startCursor,
    endCursor: pageInfo.endCursor,
    count: edges.length,
  };
}

/**
 * Get cursor for navigation
 * @param {Array} orders - Array of orders with cursor field
 * @param {string} direction - 'next' or 'previous'
 * @returns {string|null} Cursor to use for next page
 */
export function getNavigationCursor(orders, direction) {
  if (!orders || orders.length === 0) {
    return null;
  }

  if (direction === 'next') {
    // Use cursor of last item for next page
    return orders[orders.length - 1].cursor;
  } else {
    // Use cursor of first item for previous page
    return orders[0].cursor;
  }
}

export default {
  buildPaginationVariables,
  mapSortField,
  buildSearchQuery,
  extractPaginationInfo,
  getNavigationCursor,
};
