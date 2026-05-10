import express from 'express';
const router = express.Router();
import {
  addOrderItems,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  getOrders,
  exportOrders,
  getSalesAnalytics,
  generateShareableOrderLink,
  applyCoupon,
  getCouponUsageStats,
  getOrderReport,
  getOrderSystemHealth,
} from '../controllers/orderController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

router.route('/').post(protect, addOrderItems).get(protect, admin, getOrders);
router.route('/mine').get(protect, getMyOrders);
router.route('/export').get(protect, exportOrders);
router.route('/analytics').get(protect, getSalesAnalytics);
router.route('/coupon-stats').get(protect, getCouponUsageStats);
router.route('/report').get(protect, getOrderReport);
router.route('/health').get(protect, admin, getOrderSystemHealth);
router.route('/:id').get(protect, getOrderById);
router.route('/:id/pay').put(protect, updateOrderToPaid);
router.route('/:id/deliver').put(protect, admin, updateOrderToDelivered);
router.route('/:id/share').post(protect, generateShareableOrderLink);
router.route('/:id/coupon').post(protect, applyCoupon);

export default router;
