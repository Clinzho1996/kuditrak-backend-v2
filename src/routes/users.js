import express from "express";

import {
	getAnchorCustomerStatus,
	retryAnchorCustomerCreation,
} from "../controllers/authController.js";
import {
	checkConnectionLimit,
	deleteAccount,
	getDeviceTokens,
	getInsights,
	getKYCStatus,
	getProfile,
	registerDeviceToken,
	testPushNotification,
	unregisterDeviceToken,
	updateKYC,
	updateProfile,
	updateProfileImage,
	uploadIDImage,
} from "../controllers/userContoller.js";
import protect from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

// Get logged in user profile
router.get("/profile", protect, getProfile);

// Update profile image
router.put(
	"/profile-image",
	protect,
	upload.single("image"),
	updateProfileImage,
);

// Get financial insights
router.get("/insights", protect, getInsights);

// Update profile
router.put("/profile", protect, updateProfile);

// ================= KYC Routes =================
// Update KYC information
router.post("/kyc", protect, updateKYC);

// Get KYC status
router.get("/kyc/status", protect, getKYCStatus);
router.post("/upload-id-image", protect, upload.single("image"), uploadIDImage);
router.post("/anchor/retry", protect, retryAnchorCustomerCreation);
router.get("/anchor/status", protect, getAnchorCustomerStatus);

// ================= Push Notification Routes =================
router.post("/test", protect, testPushNotification);
router.post("/device-token", protect, registerDeviceToken);
router.delete("/device-token", protect, unregisterDeviceToken);
router.get("/device-tokens", protect, getDeviceTokens);

// ================= Limit Check Routes =================
router.get("/check-limit", protect, checkConnectionLimit);

// Delete user account
router.delete("/delete-account", protect, deleteAccount);

export default router;
