/**
 * Client-safe pagination utilities
 * These functions can be used in both server and client code
 */

/**
 * Build URL with pagination parameters
 * @param {string} baseUrl - Base URL path
 * @param {Object} params - URL parameters
 * @returns {string} Full URL with parameters
 */
export function buildPaginationUrl(baseUrl, params = {}) {
  const {
    cursor,
    direction,
    search,
    sortField,
    sortDirection,
  } = params;

  const searchParams = new URLSearchParams();

  if (cursor) searchParams.set('cursor', cursor);
  if (direction) searchParams.set('direction', direction);
  if (search) searchParams.set('search', search);
  if (sortField) searchParams.set('sortField', sortField);
  if (sortDirection) searchParams.set('sortDirection', sortDirection);

  const queryString = searchParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}
