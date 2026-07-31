import express from 'express';
const router = express.Router();
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  createProductReview,
  getTopProducts,
  getLowStockProducts,
  updateStock,
  searchProducts,
  generateReviewInviteLink,
  getFeaturedProduct,
} from '../controllers/productController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import checkObjectId from '../middleware/checkObjectId.js';

router.route('/').get(getProducts).post(protect, admin, createProduct);
router.get('/search', searchProducts);
router.get('/featured', getFeaturedProduct);
router.route('/:id/reviews').post(protect, checkObjectId, createProductReview);
router.route('/:id/invite').post(protect, admin, checkObjectId, generateReviewInviteLink);
router.route('/:id/stock').put(protect, admin, checkObjectId, updateStock);
router.get('/top', getTopProducts);
router
  .route('/:id')
  .get(checkObjectId, getProductById)
  .put(protect, admin, checkObjectId, updateProduct)
  .delete(protect, admin, checkObjectId, deleteProduct);
router.get('/low-stock', protect, admin, getLowStockProducts);

export default router;
