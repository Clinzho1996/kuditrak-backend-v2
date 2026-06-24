// backend/routes/userRoutes.js - Add Dojah routes

import express from "express";
import {
	checkConnectionLimit,
	completeKYC,
	deleteAccount,
	getDeviceTokens,
	getInsights,
	getKYCStatus,
	getProfile,
	registerDeviceToken,
	searchKuditrakUsers,
	testPushNotification,
	unregisterDeviceToken,
	updateKYC,
	updateProfile,
	updateProfileImage,
	uploadIDImage,
	verifyAddress,
	verifyBVN,
	verifyDriversLicense,
	verifyLiveness,
	verifyNIN,
	verifyPassport,
} from "../controllers/userContoller.js";
import protect from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

// Profile Routes
router.get("/profile", protect, getProfile);
router.put("/profile", protect, updateProfile);
router.put(
	"/profile-image",
	protect,
	upload.single("image"),
	updateProfileImage,
);
router.get("/insights", protect, getInsights);

// Search
router.get("/search", protect, searchKuditrakUsers);

// KYC Routes
router.get("/kyc/status", protect, getKYCStatus);
router.post("/kyc", protect, updateKYC);
router.post("/upload-id-image", protect, upload.single("image"), uploadIDImage);

// Dojah KYC Routes
router.post("/kyc/verify-nin", protect, verifyNIN);
router.post("/kyc/verify-bvn", protect, verifyBVN);
router.post("/kyc/verify-passport", protect, verifyPassport);
router.post("/kyc/verify-drivers-license", protect, verifyDriversLicense);
router.post("/kyc/verify-address", protect, verifyAddress);
router.post("/kyc/verify-liveness", protect, verifyLiveness);
router.post("/kyc/complete", protect, completeKYC);

// Push Notification Routes
router.post("/device-token", protect, registerDeviceToken);
router.delete("/device-token", protect, unregisterDeviceToken);
router.get("/device-tokens", protect, getDeviceTokens);
router.post("/test-push", protect, testPushNotification);

// Account Management
router.get("/check-limit", protect, checkConnectionLimit);
router.delete("/delete-account", protect, deleteAccount);

export default router;
