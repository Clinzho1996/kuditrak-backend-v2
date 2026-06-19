import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import BankConnection from "../models/BankConnection.js";
import BridgecardCardholder from "../models/BridgecardCardholder.js";
import User from "../models/User.js";
import { generateFinancialInsights } from "../services/aiService.js";
import {
	getCustomerKYCStatus,
	getOrCreateAnchorCustomer,
	upgradeCustomerToTier1,
} from "../services/anchorCustomerService.js";
import bridgecardService from "../services/bridgecardService.js";
import {
	removeDeviceToken,
	saveDeviceToken,
	sendPushToUser,
} from "../services/pushService.js";

dotenv.config();

// Configure Cloudinary
cloudinary.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

/*
|--------------------------------------------------------------------------
| Get Financial Insights
|--------------------------------------------------------------------------
*/
export const getInsights = async (req, res) => {
	try {
		const insights = await generateFinancialInsights(req.user._id);
		res.status(200).json({ success: true, data: insights });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Get Profile
|--------------------------------------------------------------------------
*/
export const getProfile = async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("-password");
		if (!user) return res.status(404).json({ error: "User not found" });
		res.status(200).json(user);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Update Profile
|--------------------------------------------------------------------------
*/
export const updateProfile = async (req, res) => {
	try {
		const { fullName, email, phoneNumber } = req.body;
		const userId = req.user._id;

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ error: "User not found" });

		if (email && email !== user.email) {
			const existingUser = await User.findOne({ email });
			if (existingUser)
				return res.status(400).json({ error: "Email already in use" });
			user.email = email;
		}

		if (fullName) user.fullName = fullName;
		if (phoneNumber) user.phoneNumber = phoneNumber;

		await user.save();

		const updatedUser = await User.findById(userId).select("-password");
		res.status(200).json({
			success: true,
			message: "Profile updated successfully",
			user: updatedUser,
		});
	} catch (err) {
		console.error("Update profile error:", err);
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Update Profile Image
|--------------------------------------------------------------------------
*/
export const updateProfileImage = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: "No image uploaded" });
		}

		const result = await cloudinary.uploader.upload(req.file.path, {
			folder: "kuditrak/profile",
		});

		const user = await User.findById(req.user._id);
		if (!user) return res.status(404).json({ error: "User not found" });

		user.profileImage = result.secure_url;
		await user.save();

		res.status(200).json({
			success: true,
			message: "Profile image updated",
			profileImage: result.secure_url,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/userController.js - Updated updateKYC

export const updateKYC = async (req, res) => {
	try {
		const userId = req.user._id;
		const { bvn, dateOfBirth, gender, address, identification } = req.body;

		console.log("🔵 KYC Update Request Started");
		console.log("User ID:", userId);

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Ensure Anchor customer exists (Tier 0)
		const anchorCustomerResult = await getOrCreateAnchorCustomer(userId);
		if (!anchorCustomerResult.success) {
			return res.status(400).json({
				error: "Failed to initialize banking profile",
				message: anchorCustomerResult.error,
			});
		}

		// Check current KYC level from Anchor
		const kycStatus = await getCustomerKYCStatus(userId);

		// If already at Tier 1 or higher
		if (
			kycStatus.isVerified ||
			kycStatus.kycLevel === "TIER_1" ||
			kycStatus.kycLevel === "TIER_2"
		) {
			// Update user record
			user.kyc.isVerified = true;
			user.kyc.verifiedAt = new Date();
			if (bvn) user.kyc.bvn = bvn;
			if (dateOfBirth) user.kyc.dateOfBirth = new Date(dateOfBirth);
			if (gender) user.kyc.gender = gender;
			await user.save();

			// Also register with Bridgecard if not already
			await registerWithBridgecard(userId);

			return res.status(200).json({
				success: true,
				message: "KYC already verified",
				kyc: {
					isVerified: true,
					level: kycStatus.kycLevel,
				},
			});
		}

		// Save basic KYC data first
		if (address) {
			user.kyc.address = {
				street: address.street || user.kyc.address?.street,
				city: address.city || user.kyc.address?.city,
				state: address.state || user.kyc.address?.state,
				country: address.country || "NG",
				postalCode: address.postalCode || user.kyc.address?.postalCode,
			};
		}

		if (identification) {
			user.kyc.identification = {
				type: identification.type || user.kyc.identification?.type,
				number: identification.number || user.kyc.identification?.number,
				imageUrl: identification.imageUrl || user.kyc.identification?.imageUrl,
			};
		}

		// If BVN and DOB provided, upgrade to Tier 1
		if (bvn && dateOfBirth && gender) {
			console.log("🔵 Upgrading KYC to Tier 1 with Anchor...");

			const upgradeResult = await upgradeCustomerToTier1(
				userId,
				bvn,
				dateOfBirth,
				gender,
			);

			if (!upgradeResult.success) {
				return res.status(400).json({
					error: "KYC upgrade failed",
					message: upgradeResult.error,
				});
			}

			// If already upgraded
			if (upgradeResult.alreadyUpgraded) {
				user.kyc.isVerified = true;
				user.kyc.verifiedAt = new Date();
				await user.save();

				// Register with Bridgecard
				await registerWithBridgecard(userId);

				return res.status(200).json({
					success: true,
					message: "KYC already verified",
					kyc: {
						isVerified: true,
						isComplete: true,
					},
				});
			}

			// Save KYC data
			user.kyc.bvn = bvn;
			user.kyc.dateOfBirth = new Date(dateOfBirth);
			user.kyc.gender = gender;
			user.kyc.anchorVerificationId = upgradeResult.verificationId;
			user.kyc.paystackValidationPending = true;

			await user.save();

			return res.status(202).json({
				success: true,
				pending: true,
				message:
					"KYC verification submitted. You will receive a notification when complete.",
				kyc: {
					isVerified: false,
					isComplete: true,
					pendingValidation: true,
				},
			});
		}

		// Just save partial KYC data
		await user.save();

		const isKYCComplete =
			!!user.kyc.bvn && !!user.kyc.dateOfBirth && !!user.kyc.address?.street;

		return res.status(200).json({
			success: true,
			message: "KYC data saved",
			pending: false,
			kyc: {
				isVerified: user.kyc.isVerified,
				isComplete: isKYCComplete,
				pendingValidation: false,
			},
		});
	} catch (err) {
		console.error("❌ Update KYC error:", err);
		res.status(500).json({
			error: err.message,
			message: "Failed to update KYC. Please try again.",
		});
	}
};

/**
 * Register user with Bridgecard after KYC verification
 */
async function registerWithBridgecard(userId) {
	try {
		const user = await User.findById(userId);
		if (!user) return;

		// Check if already registered
		const existingCardholder = await BridgecardCardholder.findOne({ userId });
		if (existingCardholder) return;

		// Prepare cardholder data
		const nameParts = user.fullName.split(" ");
		const firstName = nameParts[0];
		const lastName = nameParts.slice(1).join(" ") || firstName;

		const cardholderData = {
			first_name: firstName,
			last_name: lastName,
			address: {
				address: user.kyc?.address?.street || "Unknown Street",
				city: user.kyc?.address?.city || "Lagos",
				state: user.kyc?.address?.state || "Lagos",
				country: "Nigeria",
				postal_code: user.kyc?.address?.postalCode || "1000242",
				house_no: "1",
			},
			phone: bridgecardService.formatPhoneNumber(
				user.phoneNumber || "08000000000",
			),
			email_address: user.email,
			identity: {
				id_type: "NIGERIAN_BVN_VERIFICATION",
				bvn: user.kyc?.bvn || "22222222222222",
				selfie_image: user.profileImage || "https://example.com/selfie.jpg",
			},
			meta_data: {
				userId: user._id.toString(),
				platform: "kuditrak",
			},
		};

		const result =
			await bridgecardService.registerCardholderSync(cardholderData);

		if (result.success) {
			await BridgecardCardholder.create({
				userId,
				cardholderId: result.cardholderId,
				isActive: true,
				isIdVerified: true,
				bridgecardData: result.data || {},
				metaData: { registeredAt: new Date() },
			});
			console.log("✅ Bridgecard cardholder registered for user:", userId);
		}
	} catch (error) {
		console.error("Bridgecard registration error:", error);
	}
}

// controllers/userContoller.js - Update getKYCStatus
export const getKYCStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ error: "User not found" });

		const isKYCComplete =
			!!user.kyc?.bvn &&
			!!user.kyc?.dateOfBirth &&
			!!user.kyc?.address?.street &&
			!!user.kyc?.address?.city &&
			!!user.kyc?.address?.state &&
			!!user.kyc?.identification?.type &&
			!!user.kyc?.identification?.number;

		res.status(200).json({
			success: true,
			kyc: {
				isVerified: user.kyc?.isVerified || false,
				isComplete: isKYCComplete,
				pendingValidation: user.kyc?.paystackValidationPending || false,
				hasBvn: !!user.kyc?.bvn,
				hasDateOfBirth: !!user.kyc?.dateOfBirth,
				hasAddress: !!(
					user.kyc?.address?.street &&
					user.kyc?.address?.city &&
					user.kyc?.address?.state
				),
				hasIdentification: !!(
					user.kyc?.identification?.type && user.kyc?.identification?.number
				),
				verifiedAt: user.kyc?.verifiedAt || null,
			},
		});
	} catch (err) {
		console.error("Get KYC status error:", err);
		res.status(500).json({ error: err.message });
	}
};
/*
|--------------------------------------------------------------------------
| Device Token Management
|--------------------------------------------------------------------------
*/
export const registerDeviceToken = async (req, res) => {
	try {
		const { userId, token, deviceType } = req.body;

		if (req.user._id.toString() !== userId) {
			return res.status(403).json({ error: "Unauthorized" });
		}

		if (!token || !deviceType) {
			return res
				.status(400)
				.json({ error: "Token and deviceType are required" });
		}

		await saveDeviceToken(userId, token, deviceType);

		res.status(200).json({
			success: true,
			message: "Device token registered successfully",
		});
	} catch (err) {
		console.error("Register device token error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const unregisterDeviceToken = async (req, res) => {
	try {
		const { userId, token } = req.body;

		if (req.user._id.toString() !== userId) {
			return res.status(403).json({ error: "Unauthorized" });
		}

		if (!token) {
			return res.status(400).json({ error: "Token is required" });
		}

		await removeDeviceToken(userId, token);

		res.status(200).json({
			success: true,
			message: "Device token unregistered successfully",
		});
	} catch (err) {
		console.error("Unregister device token error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const getDeviceTokens = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId)
			.select("deviceTokens email fullName")
			.lean();

		if (!user) return res.status(404).json({ error: "User not found" });

		res.json({
			success: true,
			deviceTokens: user.deviceTokens || [],
			tokenCount: user.deviceTokens?.length || 0,
		});
	} catch (error) {
		console.error("Error getting device tokens:", error);
		res.status(500).json({ error: error.message });
	}
};

export const testPushNotification = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId).select("deviceTokens email");

		if (!user) return res.status(404).json({ error: "User not found" });

		if (!user.deviceTokens || user.deviceTokens.length === 0) {
			return res.status(400).json({
				success: false,
				message: "No device tokens registered for this user",
			});
		}

		const result = await sendPushToUser(
			userId,
			"🧪 Test Notification",
			"This is a test push notification from Kuditrak! Tap to open the app.",
			{ type: "test", timestamp: new Date().toISOString(), screen: "home" },
		);

		res.status(200).json({
			success: true,
			message: "Test notification sent!",
			result,
		});
	} catch (err) {
		console.error("Test push error:", err);
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Account Management
|--------------------------------------------------------------------------
*/
export const checkConnectionLimit = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId);
		const plan = user.subscription?.plan || "free";

		const limits = { free: 0, basic: 3, pro: Infinity };

		const bankCount = await BankConnection.countDocuments({
			userId,
			status: "Active",
		});
		const canConnect = bankCount < limits[plan];

		res.status(200).json({
			success: true,
			canConnect,
			message: canConnect
				? "You can connect bank accounts"
				: "Upgrade to connect bank accounts",
			remaining: limits[plan] - bankCount,
			plan,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

export const deleteAccount = async (req, res) => {
	try {
		const { reason } = req.body;
		const user = await User.findById(req.user._id);

		if (!user) return res.status(404).json({ error: "User not found" });

		user.deletedReason = reason;
		await user.save();
		await User.findByIdAndDelete(req.user._id);

		res
			.status(200)
			.json({ success: true, message: "Account deleted successfully" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/userController.js - Add this function

/**
 * Upload ID image for KYC verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
// backend/controllers/userController.js

/**
 * Upload ID image for KYC verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const uploadIDImage = async (req, res) => {
	try {
		const userId = req.user?._id;

		// Check if user is authenticated
		if (!userId) {
			return res.status(401).json({
				success: false,
				message: "User not authenticated",
			});
		}

		// Check if file was uploaded
		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "No image file provided",
			});
		}

		// Validate file type
		const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/heic"];
		if (!allowedTypes.includes(req.file.mimetype)) {
			return res.status(400).json({
				success: false,
				message: "Invalid file type. Please upload a JPEG, PNG, or HEIC image.",
			});
		}

		// Validate file size (max 5MB)
		const maxSize = 5 * 1024 * 1024; // 5MB
		if (req.file.size > maxSize) {
			return res.status(400).json({
				success: false,
				message: "File too large. Maximum size is 5MB.",
			});
		}

		// Upload to Cloudinary
		const result = await cloudinary.uploader.upload(req.file.path, {
			folder: "kuditrak/kyc/id_images",
			transformation: [{ quality: "auto:good" }, { fetch_format: "auto" }],
			allowed_formats: ["jpg", "png", "jpeg", "heic"],
		});

		console.log("✅ ID image uploaded to Cloudinary:", result.secure_url);

		// Save the image URL to user's KYC record
		const user = await User.findById(userId);
		if (user) {
			if (!user.kyc) {
				user.kyc = {};
			}
			if (!user.kyc.identification) {
				user.kyc.identification = {};
			}
			user.kyc.identification.imageUrl = result.secure_url;
			await user.save();
		}

		res.status(200).json({
			success: true,
			message: "ID image uploaded successfully",
			imageUrl: result.secure_url,
			publicId: result.public_id,
		});
	} catch (error) {
		console.error("❌ ID image upload error:", error);
		res.status(500).json({
			success: false,
			message: error.message || "Failed to upload ID image",
		});
	}
};
