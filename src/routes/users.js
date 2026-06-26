// backend/routes/userRoutes.js - Fixed with all imports

import express from "express";
import {
	checkConnectionLimit,
	completeKYC,
	deleteAccount,
	getDeviceTokens,
	getInsights,
	getKYCStatus,
	getProfile,
	getVirtualAccountDetails,
	registerDeviceToken,
	searchKuditrakUsers,
	submitKYCToAnchor,
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
import AnchorCustomer from "../models/AnchorCustomer.js";
import anchorService from "../services/anchorService.js";

const router = express.Router();

// ==================== PROFILE ROUTES ====================
router.get("/profile", protect, getProfile);
router.put("/profile", protect, updateProfile);
router.put(
	"/profile-image",
	protect,
	upload.single("image"),
	updateProfileImage,
);
router.get("/insights", protect, getInsights);

// ==================== SEARCH ====================
router.get("/search", protect, searchKuditrakUsers);

// ==================== KYC ROUTES ====================
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
// backend/routes/userRoutes.js - Add this route

router.post("/kyc/submit-to-anchor", protect, submitKYCToAnchor);

// ==================== VIRTUAL ACCOUNT ROUTES ====================
// Create virtual account (Anchor deposit account + virtual NUBAN)
router.post("/virtual-account/create", protect, async (req, res, next) => {
	try {
		const userId = req.user._id;
		console.log("🔵 Creating virtual account for user:", userId);

		const result = await createVirtualAccountForUser(userId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
				requiresKYC: result.requiresKYC || false,
			});
		}

		res.status(200).json({
			success: true,
			message: "Virtual account created successfully",
			account: {
				id: result.account._id,
				accountNumber: result.account.accountNumber,
				bankName: result.account.bankName,
				accountName: result.account.accountName,
				isActive: result.account.isActive,
			},
		});
	} catch (error) {
		console.error("❌ Create virtual account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
});

// backend/routes/userRoutes.js - Add this debug route

router.get("/debug/check-anchor-kyc", protect, async (req, res) => {
	try {
		const userId = req.user._id;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.json({
				success: false,
				message: "No Anchor customer found",
				localKyc: "none",
			});
		}

		// Fetch fresh status from Anchor
		const customerResponse = await anchorService.getAnchorCustomer(
			anchorCustomer.anchorCustomerId,
		);

		res.json({
			success: true,
			local: {
				anchorCustomerId: anchorCustomer.anchorCustomerId,
				kycLevel: anchorCustomer.kycLevel,
				kycStatus: anchorCustomer.kycStatus,
				verificationId: anchorCustomer.currentVerificationId,
			},
			anchor: customerResponse.success
				? {
						kycLevel: customerResponse.kycLevel,
						kycStatus: customerResponse.kycStatus,
						customer: customerResponse.customer,
					}
				: {
						error: customerResponse.error,
					},
			user: {
				hasBvn: !!req.user.kyc?.bvn,
				hasDateOfBirth: !!req.user.kyc?.dateOfBirth,
				hasGender: !!req.user.kyc?.gender,
				isVerified: req.user.kyc?.isVerified,
			},
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Get virtual account details with real-time balance
router.get("/virtual-account", protect, getVirtualAccountDetails);

// ==================== PUSH NOTIFICATION ROUTES ====================
router.post("/device-token", protect, registerDeviceToken);
router.delete("/device-token", protect, unregisterDeviceToken);
router.get("/device-tokens", protect, getDeviceTokens);
router.post("/test-push", protect, testPushNotification);

// ==================== ACCOUNT MANAGEMENT ====================
router.get("/check-limit", protect, checkConnectionLimit);
router.delete("/delete-account", protect, deleteAccount);

export default router;
