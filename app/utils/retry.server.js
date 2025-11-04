/**
 * Retry Logic with Exponential Backoff
 * Tự động retry API calls khi gặp lỗi network hoặc timeout
 */

import { logError } from './logger.server.js';

/**
 * Sleep function for delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @param {Function} options.shouldRetry - Function to determine if error should be retried
 * @param {string} options.context - Context for logging
 * @returns {Promise}
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry,
    context = 'Unknown',
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        logError(context, error, {
          retryable: false,
          message: 'Error is not retryable'
        });
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt === maxRetries) {
        logError(context, error, {
          attempt: attempt + 1,
          maxRetries,
          message: 'Max retries exhausted'
        });
        throw error;
      }

      // Log retry attempt
      console.log(
        `[${context}] Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${delay}ms...`,
        { error: error.message }
      );

      // Wait before retrying
      await sleep(delay);

      // Increase delay exponentially, capped at maxDelay
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Default function to determine if an error should be retried
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
function defaultShouldRetry(error) {
  // Retry on network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // Retry on HTTP 5xx errors (server errors)
  if (error.status >= 500 && error.status < 600) {
    return true;
  }

  // Retry on HTTP 429 (Too Many Requests)
  if (error.status === 429) {
    return true;
  }

  // Retry on timeout errors
  if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
    return true;
  }

  // Don't retry on client errors (4xx except 429)
  if (error.status >= 400 && error.status < 500) {
    return false;
  }

  // Default: retry on unknown errors (could be network issues)
  return true;
}

/**
 * Wrapper for fetch with retry logic
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryOptions - Retry options
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const context = retryOptions.context || `Fetch ${url}`;

  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timeout = options.timeout || 30000; // 30s default timeout

      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check if response is ok
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.status = response.status;
          error.response = response;
          throw error;
        }

        return response;
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle abort errors
        if (error.name === 'AbortError') {
          const timeoutError = new Error('Request timeout');
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }

        throw error;
      }
    },
    {
      ...retryOptions,
      context,
    }
  );
}

/**
 * Retry options for Shopify API calls
 */
export const shopifyRetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  context: 'Shopify API',
  shouldRetry: (error) => {
    // Shopify rate limit
    if (error.status === 429) {
      return true;
    }
    return defaultShouldRetry(error);
  },
};

/**
 * Retry options for Warehouse API calls
 */
export const warehouseRetryOptions = {
  maxRetries: 3,
  initialDelay: 2000,
  maxDelay: 15000,
  context: 'Warehouse API',
  shouldRetry: (error) => {
    // Don't retry on 400 Bad Request (data validation errors)
    if (error.status === 400) {
      return false;
    }
    return defaultShouldRetry(error);
  },
};

/**
 * Retry options for webhook calls
 */
export const webhookRetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  context: 'Webhook',
};

export default retryWithBackoff;
