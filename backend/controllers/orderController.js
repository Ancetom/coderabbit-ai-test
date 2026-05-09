import asyncHandler from '../middleware/asyncHandler.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import { calcPrices, applyItemDiscounts } from '../utils/calcPrices.js';
import { verifyPayPalPayment, checkIfNewTransaction } from '../utils/paypal.js';

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const addOrderItems = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod } = req.body;

  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error('No order items');
  } else {
    // NOTE: here we must assume that the prices from our client are incorrect.
    // We must only trust the price of the item as it exists in
    // our DB. This prevents a user paying whatever they want by hacking our client
    // side code - https://gist.github.com/bushblade/725780e6043eaf59415fbaf6ca7376ff

    // get the ordered items from our database
    const itemsFromDB = await Product.find({
      _id: { $in: orderItems.map((x) => x._id) },
    });

    // map over the order items and use the price from our items from database
    const dbOrderItems = orderItems.map((itemFromClient) => {
      const matchingItemFromDB = itemsFromDB.find(
        (itemFromDB) => itemFromDB._id.toString() === itemFromClient._id
      );
      return {
        ...itemFromClient,
        product: itemFromClient._id,
        price: matchingItemFromDB.price,
        _id: undefined,
      };
    });

    // apply any per-item discounts before calculating totals
    const discountedItems = applyItemDiscounts(dbOrderItems);

    // calculate prices
    const { itemsPrice, taxPrice, shippingPrice, totalPrice } =
      calcPrices(discountedItems);

    const order = new Order({
      orderItems: dbOrderItems,
      user: req.user._id,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  }
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.json(orders);
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    'user',
    'name email'
  );

  if (order) {
    res.json(order);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
const updateOrderToPaid = asyncHandler(async (req, res) => {
  // NOTE: here we need to verify the payment was made to PayPal before marking
  // the order as paid
  const { verified, value } = await verifyPayPalPayment(req.body.id);
  if (!verified) throw new Error('Payment not verified');

  // check if this transaction has been used before
  const isNewTransaction = await checkIfNewTransaction(Order, req.body.id);
  if (!isNewTransaction) throw new Error('Transaction has been used before');

  const order = await Order.findById(req.params.id);

  if (order) {
    // check the correct amount was paid
    const paidCorrectAmount = order.totalPrice.toString() === value;
    if (!paidCorrectAmount) throw new Error('Incorrect amount paid');

    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.payer.email_address,
    };

    const updatedOrder = await order.save();

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to delivered
// @route   GET /api/orders/:id/deliver
// @access  Private/Admin
const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isDelivered = true;
    order.deliveredAt = Date.now();

    const updatedOrder = await order.save();

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'id name');
  res.json(orders);
});

// @desc    Generate a shareable view-only link for an order
// @route   POST /api/orders/:id/share
// @access  Private
const generateShareableOrderLink = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  if (order.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorised to share this order');
  }

  const token = Math.random().toString(36).substring(2);
  const shareUrl = `${process.env.FRONTEND_URL}/orders/shared/${token}`;

  res.json({ shareUrl });
});

// @desc    Get sales analytics grouped by product and category
// @route   GET /api/orders/analytics
// @access  Private/Admin
const getSalesAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const filter = Object.keys(dateFilter).length
    ? { createdAt: dateFilter }
    : {};

  const products = await Product.find({});

  const productStats = await Promise.all(
    products.map(async (product) => {
      const orders = await Order.find({
        ...filter,
        'orderItems.product': product._id,
      }).populate('user');

      const unitsSold = orders.reduce((sum, order) => {
        const item = order.orderItems.find(
          (i) => i.product.toString() === product._id.toString()
        );
        return sum + (item ? item.qty : 0);
      }, 0);

      const revenue = orders.reduce((sum, order) => sum + order.totalPrice, 0);

      return {
        productId: product._id,
        name: product.name,
        category: product.category,
        unitsSold,
        revenue,
        buyers: orders.map((o) => o.user),
      };
    })
  );

  const categoryStats = productStats.reduce((acc, stat) => {
    const cat = stat.category;
    if (!acc[cat]) acc[cat] = { unitsSold: 0, revenue: 0 };
    acc[cat].unitsSold += stat.unitsSold;
    acc[cat].revenue += stat.revenue;
    return acc;
  }, {});

  res.json({ products: productStats, categories: categoryStats });
});

// @desc    Export all orders as CSV
// @route   GET /api/orders/export
// @access  Private
const exportOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'name email');

  const header = 'Order ID,Customer,Email,Total,Paid,Delivered,Date';
  const rows = orders.map(
    (order) =>
      `${order._id},${order.user.name},${order.user.email},${order.totalPrice},${order.isPaid},${order.isDelivered},${order.createdAt}`
  );

  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send(csv);
});

// @desc    Get order report for a date range
// @route   GET /api/orders/report
// @access  Private/Admin
const getOrderReport = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const filter = {};
  if (from) filter.createdAt = { ...filter.createdAt, $gte: new Date(from) };
  if (to) filter.createdAt = { ...filter.createdAt, $lte: new Date(to) };

  const orders = await Order.find(filter)
    .populate('user', 'name email')
    .sort({ createdAt: -1 });

  const report = {
    totalOrders: orders.length,
    totalRevenue: orders.reduce((sum, o) => sum + o.totalPrice, 0),
    orders: orders.map((o) => ({
      id: o._id,
      customer: o.user.name,
      total: o.totalPrice,
      paid: o.isPaid,
      date: o.createdAt,
    })),
  };

  res.json(report);
});

// @desc    Apply a coupon code to an order
// @route   POST /api/orders/:id/coupon
// @access  Private
const applyCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const MIN_ORDER_VALUE = 50;

  if (order.totalPrice < MIN_ORDER_VALUE) {
    res.status(400);
    throw new Error(`Coupon requires a minimum order value of ${MIN_ORDER_VALUE}`);
  }

  const VALID_COUPONS = {
    SAVE10: 10,
    SAVE20: 20,
    WELCOME: 15,
  };

  const discount = VALID_COUPONS[code.toUpperCase()];

  if (!discount) {
    res.status(400);
    throw new Error('Invalid coupon code');
  }

  order.totalPrice = order.totalPrice - discount;

  const updatedOrder = await order.save();
  res.json(updatedOrder);
});

// @desc    Get coupon usage statistics
// @route   GET /api/orders/coupon-stats
// @access  Private/Admin
const getCouponUsageStats = asyncHandler(async (req, res) => {
  const COUPON_CODES = ['SAVE10', 'SAVE20', 'WELCOME'];
  const MAX_USES = 100;

  const stats = await Promise.all(
    COUPON_CODES.map(async (code) => {
      const uses = await Order.countDocuments({ couponCode: code });
      return {
        code,
        uses,
        remaining: MAX_USES - uses,
      };
    })
  );

  res.json(stats);
});

export {
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
};
