// backend/controllers/anchorCustomerController.js
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import {
	getCustomerKYCStatus,
	getOrCreateAnchorCustomer,
	submitKYCForVerification,
	upgradeCustomerToTier1,
} from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";

/**
 * Create or get Anchor customer for authenticated user
 */
export const createAnchorCustomer = async (req, res) => {
	try {
		const userId = req.user._id;

		// Check if user already has Anchor customer
		const existingCustomer = await AnchorCustomer.findOne({ userId });
		if (existingCustomer) {
			return res.status(200).json({
				success: true,
				message: "Anchor customer already exists",
				customer: {
					id: existingCustomer.anchorCustomerId,
					kycLevel: existingCustomer.kycLevel,
					kycStatus: existingCustomer.kycStatus,
				},
			});
		}

		const result = await getOrCreateAnchorCustomer(userId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				message: result.error,
			});
		}

		res.status(201).json({
			success: true,
			message: "Anchor customer created successfully",
			customer: {
				id: result.customerId,
				kycLevel: result.anchorCustomer.kycLevel,
				kycStatus: result.anchorCustomer.kycStatus,
			},
		});
	} catch (error) {
		console.error("Create Anchor customer error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};

/**
 * Get customer status
 */
export const getCustomerStatus = async (req, res) => {
	try {
		const userId = req.user._id;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				message: "Anchor customer not found. Please create a customer first.",
				requiresCreation: true,
			});
		}

		const kycStatus = await getCustomerKYCStatus(userId);

		res.status(200).json({
			success: true,
			customer: {
				id: anchorCustomer.anchorCustomerId,
				kycLevel: anchorCustomer.kycLevel,
				kycStatus: anchorCustomer.kycStatus,
				isVerified: kycStatus.success ? kycStatus.isVerified : false,
			},
		});
	} catch (error) {
		console.error("Get customer status error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};

export const upgradeKYC = async (req, res) => {
	try {
		const userId = req.user._id;
		const { bvn, dateOfBirth, gender } = req.body;

		// Validate required fields
		if (!bvn || !dateOfBirth || !gender) {
			return res.status(400).json({
				success: false,
				message: "BVN, date of birth, and gender are required",
			});
		}

		// Validate BVN format (11 digits)
		if (!/^\d{11}$/.test(bvn)) {
			return res.status(400).json({
				success: false,
				message: "Invalid BVN format. Must be 11 digits.",
			});
		}

		// Check if user has Anchor customer
		let anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				message: "Anchor customer not found. Please complete onboarding first.",
			});
		}

		// FIRST: Get actual status from Anchor (don't trust local DB)
		const customerResponse = await anchorService.getAnchorCustomer(
			anchorCustomer.anchorCustomerId,
		);

		if (customerResponse.success) {
			const attributes = customerResponse.customer.attributes;
			const verification = attributes?.verification || {};
			const actualKycStatus =
				verification?.status || attributes?.kycStatus || "unverified";
			const actualKycLevel =
				verification?.level || attributes?.kycLevel || "TIER_0";

			console.log(
				`📊 Actual Anchor Status: ${actualKycStatus}, Level: ${actualKycLevel}`,
			);

			// If already approved, just update local DB
			if (
				actualKycStatus === "approved" ||
				actualKycLevel === "TIER_1" ||
				actualKycLevel === "TIER_2"
			) {
				// Update local records
				anchorCustomer.kycLevel = actualKycLevel;
				anchorCustomer.kycStatus = actualKycStatus;
				await anchorCustomer.save();

				const user = await User.findById(userId);
				if (user) {
					user.anchorKycLevel = actualKycLevel;
					user.kyc.isVerified = true;
					user.kyc.verifiedAt = new Date();
					await user.save();
				}

				return res.status(200).json({
					success: true,
					message: `KYC already verified at level ${actualKycLevel}`,
					alreadyVerified: true,
					kyc: {
						level: actualKycLevel,
						status: actualKycStatus,
						isVerified: true,
					},
				});
			}

			// If verification is pending, don't try again
			if (actualKycStatus === "pending") {
				return res.status(400).json({
					success: false,
					message:
						"KYC verification already in progress. Please wait for completion.",
					status: "pending",
				});
			}
		}

		// Now check local DB (after verifying with Anchor)
		if (anchorCustomer.kycLevel !== "TIER_0") {
			// Local DB might be out of sync, but we already checked Anchor
			// Force update local to match Anchor
			anchorCustomer.kycLevel = "TIER_0";
			anchorCustomer.kycStatus = "unverified";
			await anchorCustomer.save();
		}

		// Proceed with upgrade
		const result = await upgradeCustomerToTier1(
			userId,
			bvn,
			dateOfBirth,
			gender,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				message: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message:
				"KYC upgrade initiated. You will receive a notification when complete.",
			verificationId: result.verificationId,
			status: result.status,
		});
	} catch (error) {
		console.error("Upgrade KYC error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};
/**
 * Get KYC status
 */
export const getKYCStatus = async (req, res) => {
	try {
		const userId = req.user._id;

		const result = await getCustomerKYCStatus(userId);

		if (!result.success) {
			return res.status(404).json({
				success: false,
				message: result.error,
			});
		}

		res.status(200).json({
			success: true,
			kyc: {
				level: result.kycLevel,
				status: result.kycStatus,
				isVerified: result.isVerified,
			},
		});
	} catch (error) {
		console.error("Get KYC status error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};

/**
 * Get customer wallet
 */
export const getCustomerWallet = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return res.status(404).json({
				success: false,
				message: "Wallet not found",
			});
		}

		res.status(200).json({
			success: true,
			wallet: {
				id: wallet.walletId,
				name: wallet.name,
				balance: wallet.balance,
				currency: wallet.currency,
				status: wallet.status,
			},
		});
	} catch (error) {
		console.error("Get customer wallet error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};

// backend/controllers/anchorCustomerController.js

// backend/controllers/anchorCustomerController.js - Updated getCustomerDetails

export const getCustomerDetails = async (req, res) => {
	try {
		const userId = req.user._id;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				message: "Anchor customer not found",
			});
		}

		// Fetch customer from Anchor
		const customerResponse = await anchorService.getAnchorCustomer(
			anchorCustomer.anchorCustomerId,
		);

		if (!customerResponse.success) {
			return res.status(400).json({
				success: false,
				message: "Failed to fetch customer from Anchor",
				error: customerResponse.error,
			});
		}

		const attributes = customerResponse.customer.attributes;

		// Extract KYC info from verification object
		const verification = attributes?.verification || {};
		const kycLevel = verification?.level || attributes?.kycLevel || "TIER_0";
		const kycStatus =
			verification?.status || attributes?.kycStatus || "unverified";

		// Check if customer can create cards based on verification status
		const canCreateCards =
			kycStatus === "approved" ||
			kycLevel === "TIER_1" ||
			kycLevel === "TIER_2";

		console.log("📊 Extracted KYC Info:", {
			kycLevel,
			kycStatus,
			verificationLevel: verification?.level,
			verificationStatus: verification?.status,
			canCreateCards,
		});

		res.status(200).json({
			success: true,
			customer: {
				id: customerResponse.customer.id,
				kycLevel: kycLevel,
				kycStatus: kycStatus,
				verification: verification,
				status: attributes?.status,
				email: attributes?.email,
				phoneNumber: attributes?.phoneNumber,
				fullName: attributes?.fullName,
				canCreateCards: canCreateCards,
				canReceiveMoney: attributes?.canReceiveMoney !== false,
				canSendMoney: attributes?.canSendMoney !== false,
			},
		});
	} catch (error) {
		console.error("Get customer details error:", error);
		res.status(500).json({ error: error.message });
	}
};

// backend/controllers/anchorCustomerController.js - Add sync function

export const syncCustomerWithAnchor = async (req, res) => {
	try {
		const userId = req.user._id;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				message: "Anchor customer not found",
			});
		}

		// Fetch fresh data from Anchor
		const customerResponse = await anchorService.getAnchorCustomer(
			anchorCustomer.anchorCustomerId,
		);

		if (!customerResponse.success) {
			return res.status(400).json({
				success: false,
				message: "Failed to fetch customer from Anchor",
			});
		}

		const attributes = customerResponse.customer.attributes;
		const verification = attributes?.verification || {};
		const actualKycLevel =
			verification?.level || attributes?.kycLevel || "TIER_0";
		const actualKycStatus =
			verification?.status || attributes?.kycStatus || "unverified";

		console.log("🔄 Syncing customer data:");
		console.log(`   Local KYC Level: ${anchorCustomer.kycLevel}`);
		console.log(`   Actual KYC Level: ${actualKycLevel}`);
		console.log(`   Local Status: ${anchorCustomer.kycStatus}`);
		console.log(`   Actual Status: ${actualKycStatus}`);

		// Update local records if they don't match
		let updated = false;

		if (anchorCustomer.kycLevel !== actualKycLevel) {
			anchorCustomer.kycLevel = actualKycLevel;
			updated = true;
		}

		if (anchorCustomer.kycStatus !== actualKycStatus) {
			anchorCustomer.kycStatus = actualKycStatus;
			updated = true;
		}

		if (updated) {
			await anchorCustomer.save();
			console.log("✅ Updated local AnchorCustomer record");
		}

		// Update User model
		const user = await User.findById(userId);
		if (user) {
			const isVerified =
				actualKycStatus === "approved" ||
				actualKycLevel === "TIER_1" ||
				actualKycLevel === "TIER_2";

			if (user.anchorKycLevel !== actualKycLevel) {
				user.anchorKycLevel = actualKycLevel;
				updated = true;
			}

			if (isVerified && !user.kyc.isVerified) {
				user.kyc.isVerified = true;
				user.kyc.verifiedAt = new Date();
				updated = true;
			} else if (!isVerified && user.kyc.isVerified) {
				user.kyc.isVerified = false;
				updated = true;
			}

			if (updated) {
				await user.save();
				console.log("✅ Updated User record");
			}
		}

		res.status(200).json({
			success: true,
			message: updated
				? "Customer synced successfully"
				: "Customer already in sync",
			sync: {
				previous: {
					kycLevel: anchorCustomer.kycLevel,
					kycStatus: anchorCustomer.kycStatus,
				},
				current: {
					kycLevel: actualKycLevel,
					kycStatus: actualKycStatus,
				},
				updated: updated,
			},
			anchorData: {
				kycLevel: actualKycLevel,
				kycStatus: actualKycStatus,
				verification: verification,
			},
		});
	} catch (error) {
		console.error("Sync customer error:", error);
		res.status(500).json({ error: error.message });
	}
};

// backend/controllers/anchorCustomerController.js - Add this

export const submitKYCVerification = async (req, res) => {
	try {
		const userId = req.user._id;

		const result = await submitKYCForVerification(userId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				message: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message: "KYC verification submitted successfully",
			verificationId: result.verificationId,
		});
	} catch (error) {
		console.error("Submit KYC verification error:", error);
		res.status(500).json({ error: error.message });
	}
};
