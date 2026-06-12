// backend/routes/notificationRoutes.js
import express from "express";
import {
	cleanupInvalidPushTokens,
	deleteNotification,
	getNotifications,
	getNotificationSettings,
	markAllAsRead,
	markAsRead,
	registerPushToken,
	unregisterPushToken,
	updateNotificationSettings,
} from "../controllers/notificationController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Protected routes
router.use(protect);

// User routes
router.get("/", getNotifications);
router.put("/mark-all-read", markAllAsRead);
router.put("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);
router.post("/push-token", registerPushToken);
router.delete("/push-token", unregisterPushToken);
router.delete("/push-token/cleanup", cleanupInvalidPushTokens);
router.get("/settings", getNotificationSettings);
router.put("/settings", updateNotificationSettings);

export default router;
