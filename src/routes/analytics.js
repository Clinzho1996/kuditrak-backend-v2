// backend/routes/analyticsRoutes.js
import express from "express";
import {
	getAdminAIInsights,
	getAdminDashboardAnalytics,
	getAdminMonthlyTrend,
	getAdminSpendingByCategory,
} from "../controllers/adminAnalytics.js";
import {
	activateCustomer,
	bulkActivateCustomers,
	bulkDeleteCustomers,
	bulkSendPush,
	bulkSuspendCustomers,
	deleteCustomer,
	exportAllUsers,
	exportUserData,
	getAllCustomers,
	getCustomerById,
	getCustomerStats,
	resendVerificationEmail,
	sendMessageToCustomer,
	sendPushToCustomer,
	suspendCustomer,
	systemHealth,
	systemMetrics,
} from "../controllers/customerController.js";
import {
	createNotification,
	sendBulkNotification,
	sendPushToAllUsers,
} from "../controllers/notificationController.js";
import protect, { adminOnly } from "../middleware/auth.js";
const router = express.Router();

// All routes require authentication and admin privileges
router.use(protect);
router.use(adminOnly);

// Stats
router.get("/customers/stats", getCustomerStats);

// Customer CRUD
router.get("/customers", getAllCustomers);
// Admin analytics routes
router.get("/dashboard", getAdminDashboardAnalytics);
router.get("/insights", getAdminAIInsights);
router.get("/monthly-trend", getAdminMonthlyTrend);
router.get("/spending-by-category", getAdminSpendingByCategory);
// Bulk actions
router.post("/bulk/suspend", bulkSuspendCustomers);
router.post("/bulk/activate", bulkActivateCustomers);
router.post("/bulk/delete", bulkDeleteCustomers);
router.post("/bulk/push", bulkSendPush);

// Export
router.get("/export/users", exportAllUsers);
router.get("/export/user/:id", exportUserData);

// System
router.get("/health", systemHealth);
router.get("/metrics", systemMetrics);
router.post("/send-to-all", sendPushToAllUsers);

// Admin routes
router.post("/create", createNotification);
router.post("/bulk", sendBulkNotification);
router.post("/customer/bulk/suspend", bulkSuspendCustomers);
router.post("/customer/bulk/activate", bulkActivateCustomers);
router.delete("/customer/bulk/delete", bulkDeleteCustomers);
router.get("/customer/:id", getCustomerById);
router.post("/customer/:id/suspend", suspendCustomer);
router.post("/customer/:id/activate", activateCustomer);
router.delete("/customer/:id", deleteCustomer);

// Customer communication
router.post("/customer/:id/message", sendMessageToCustomer);
router.post("/customer/:id/push", sendPushToCustomer);
router.post("/customer/:id/resend-verification", resendVerificationEmail);

export default router;
