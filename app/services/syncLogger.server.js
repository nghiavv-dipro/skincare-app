/**
 * Sync Logger Service
 * Log inventory sync history to database
 */

import prisma from "../db.server";

/**
 * Tạo log entry mới cho sync job
 *
 * @param {string} shop - Shop domain
 * @returns {Promise<Object>} Log entry
 */
export async function createSyncLog(shop) {
  try {
    // const log = await prisma.inventorySyncLog.create({
    //   data: {
    //     shop,
    //     status: "running",
    //     started_at: new Date(),
    //   },
    // });

    // console.log(`[Sync Logger] Created sync log #${log.id} for shop: ${shop}`);
    // return log;
  } catch (error) {
    console.error("[Sync Logger] Error creating sync log:", error);
    throw error;
  }
}

/**
 * Update sync log khi hoàn thành
 *
 * @param {number} logId - Log ID
 * @param {Object} result - Sync result từ inventorySync service
 * @returns {Promise<Object>} Updated log entry
 */
export async function completeSyncLog(logId, result) {
  try {
    const { success, summary, results, errors } = result;

    const log = await prisma.inventorySyncLog.update({
      where: { id: logId },
      data: {
        completed_at: new Date(),
        status: success ? "success" : "failed",
        total_items: summary.total,
        success_count: summary.success,
        failed_count: summary.failed,
        skipped_count: summary.skipped,
        duration_ms: parseInt(parseFloat(summary.duration) * 1000),
        result_summary: JSON.stringify({
          summary,
          results: results.slice(0, 100), // Limit to 100 results to avoid huge JSON
          errors,
        }),
      },
    });

    console.log(`[Sync Logger] Completed sync log #${log.id}: ${log.status}`);
    return log;
  } catch (error) {
    console.error("[Sync Logger] Error completing sync log:", error);
    throw error;
  }
}

/**
 * Update sync log khi có lỗi fatal
 *
 * @param {number} logId - Log ID
 * @param {Error} error - Error object
 * @returns {Promise<Object>} Updated log entry
 */
export async function failSyncLog(logId, error) {
  try {
    const log = await prisma.inventorySyncLog.update({
      where: { id: logId },
      data: {
        completed_at: new Date(),
        status: "failed",
        error_message: error.message,
      },
    });

    console.log(`[Sync Logger] Failed sync log #${log.id}: ${error.message}`);
    return log;
  } catch (err) {
    console.error("[Sync Logger] Error failing sync log:", err);
    throw err;
  }
}

/**
 * Lấy lịch sử sync gần nhất
 *
 * @param {string} shop - Shop domain
 * @param {number} limit - Số lượng records
 * @returns {Promise<Array>} Sync logs
 */
export async function getRecentSyncLogs(shop, limit = 10) {
  try {
    const logs = await prisma.inventorySyncLog.findMany({
      where: { shop },
      orderBy: { started_at: "desc" },
      take: limit,
    });

    return logs;
  } catch (error) {
    console.error("[Sync Logger] Error getting recent logs:", error);
    return [];
  }
}

/**
 * Lấy thống kê sync
 *
 * @param {string} shop - Shop domain
 * @returns {Promise<Object>} Statistics
 */
export async function getSyncStats(shop) {
  try {
    const [total, successful, failed, lastSync] = await Promise.all([
      prisma.inventorySyncLog.count({ where: { shop } }),
      prisma.inventorySyncLog.count({ where: { shop, status: "success" } }),
      prisma.inventorySyncLog.count({ where: { shop, status: "failed" } }),
      prisma.inventorySyncLog.findFirst({
        where: { shop },
        orderBy: { started_at: "desc" },
      }),
    ]);

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : 0,
      lastSync: lastSync
        ? {
            timestamp: lastSync.started_at,
            status: lastSync.status,
            duration: lastSync.duration_ms,
          }
        : null,
    };
  } catch (error) {
    console.error("[Sync Logger] Error getting sync stats:", error);
    return null;
  }
}
