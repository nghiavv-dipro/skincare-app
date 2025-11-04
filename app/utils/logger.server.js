/**
 * Structured Logger Service
 * Sử dụng Winston để logging có cấu trúc thay vì console.log
 */

import winston from 'winston';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;

    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Add metadata if exists
    if (Object.keys(meta).length > 0) {
      msg += ` | ${JSON.stringify(meta)}`;
    }

    return msg;
  })
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, service, ...meta } = info;

    let msg = `${timestamp} [${level}]`;
    if (service) {
      msg += ` [${service}]`;
    }
    msg += `: ${message}`;

    // Add metadata if exists (except stack traces in console for readability)
    if (Object.keys(meta).length > 0 && !meta.stack) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }

    return msg;
  })
);

// Define transports
const transports = [
  // Console transport for development
  new winston.transports.Console({
    format: consoleFormat,
  }),

  // File transport for errors
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: format,
  }),

  // File transport for all logs
  new winston.transports.File({
    filename: 'logs/combined.log',
    format: format,
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Create specialized loggers for different services
export const shopifyLogger = logger.child({ service: 'Shopify' });
export const warehouseLogger = logger.child({ service: 'Warehouse' });
export const cronLogger = logger.child({ service: 'Cron' });
export const webhookLogger = logger.child({ service: 'Webhook' });
export const inventoryLogger = logger.child({ service: 'Inventory' });

// Helper functions for common logging patterns
export const logApiCall = (service, method, url, statusCode, duration) => {
  const logLevel = statusCode >= 400 ? 'error' : 'info';
  logger.log(logLevel, `API Call: ${method} ${url}`, {
    service,
    method,
    url,
    statusCode,
    duration: `${duration}ms`,
  });
};

export const logError = (service, error, context = {}) => {
  logger.error(`Error in ${service}`, {
    service,
    error: error.message,
    stack: error.stack,
    ...context,
  });
};

export const logOrderProcessing = (orderId, action, status, details = {}) => {
  logger.info(`Order ${orderId}: ${action}`, {
    service: 'OrderProcessing',
    orderId,
    action,
    status,
    ...details,
  });
};

export default logger;
