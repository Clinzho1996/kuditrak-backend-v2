// backend/controllers/userController.js - Add Dojah integration

import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import BankConnection from "../models/BankConnection.js";
import BridgecardCardholder from "../models/BridgecardCardholder.js";
import User from "../models/User.js";
import { generateFinancialInsights } from "../services/aiService.js";
import anchorService from "../services/anchorService.js";
import bridgecardService from "../services/bridgecardService.js";
import dojahService from "../services/dojahService.js";
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
| Verify NIN with Dojah
|--------------------------------------------------------------------------
*/
export const verifyNIN = async (req, res) => {
	try {
		const userId = req.user._id;
		const { nin, dateOfBirth, firstName, lastName } = req.body;

		if (!nin || nin.length !== 11) {
			return res.status(400).json({
				success: false,
				error: "Valid 11-digit NIN is required",
			});
		}

		if (!dateOfBirth) {
			return res.status(400).json({
				success: false,
				error: "Date of birth is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Call Dojah to verify NIN
		const result = await dojahService.verifyNIN(
			nin,
			firstName || user.fullName.split(" ")[0],
			lastName || user.fullName.split(" ").slice(1).join(" ") || firstName,
			dateOfBirth,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "NIN verification failed",
			});
		}

		// Save NIN verification result
		user.kyc = user.kyc || {};
		user.kyc.bvn = nin; // Store NIN in BVN field
		user.kyc.bvnVerified = result.verified;
		user.kyc.dateOfBirth = new Date(dateOfBirth);
		user.kyc.isVerified = result.verified;
		user.kyc.verifiedAt = result.verified ? new Date() : null;

		if (result.data) {
			user.kyc.identification = {
				type: "nin",
				number: nin,
				imageUrl: result.data.photo || null,
			};
		}

		await user.save();

		// If verified, create virtual account and register with Bridgecard
		if (result.verified) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			verified: result.verified,
			message: result.verified
				? "NIN verified successfully"
				: "NIN verification pending",
			data: {
				fullName: result.fullName,
				dateOfBirth: result.dateOfBirth,
				gender: result.gender,
				photo: result.photo,
				verified: result.verified,
			},
		});
	} catch (error) {
		console.error("❌ NIN verification error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/*
|--------------------------------------------------------------------------
| Verify BVN with Dojah
|--------------------------------------------------------------------------
*/
export const verifyBVN = async (req, res) => {
	try {
		const userId = req.user._id;
		const { bvn, dateOfBirth, phoneNumber } = req.body;

		if (!bvn || bvn.length !== 11) {
			return res.status(400).json({
				success: false,
				error: "Valid 11-digit BVN is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Call Dojah to verify BVN
		const result = await dojahService.verifyBVN(
			bvn,
			dateOfBirth || user.kyc?.dateOfBirth?.toISOString().split("T")[0],
			phoneNumber || user.phoneNumber,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "BVN verification failed",
			});
		}

		// Save BVN verification result
		user.kyc = user.kyc || {};
		user.kyc.bvn = bvn;
		user.kyc.bvnVerified = result.verified;
		user.kyc.dateOfBirth = result.dateOfBirth
			? new Date(result.dateOfBirth)
			: user.kyc.dateOfBirth;
		user.kyc.gender = result.gender || user.kyc.gender;
		user.kyc.isVerified = result.verified || user.kyc.isVerified;
		user.kyc.verifiedAt = result.verified ? new Date() : user.kyc.verifiedAt;

		await user.save();

		if (result.verified) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			verified: result.verified,
			message: result.verified
				? "BVN verified successfully"
				: "BVN verification pending",
			data: {
				fullName: result.fullName,
				dateOfBirth: result.dateOfBirth,
				gender: result.gender,
				image: result.image,
				verified: result.verified,
			},
		});
	} catch (error) {
		console.error("❌ BVN verification error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/*
|--------------------------------------------------------------------------
| Verify International Passport
|--------------------------------------------------------------------------
*/
export const verifyPassport = async (req, res) => {
	try {
		const userId = req.user._id;
		const { passportNumber, firstName, lastName, dateOfBirth, expiryDate } =
			req.body;

		if (!passportNumber) {
			return res.status(400).json({
				success: false,
				error: "Passport number is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const result = await dojahService.verifyPassport(
			passportNumber,
			firstName || user.fullName.split(" ")[0],
			lastName || user.fullName.split(" ").slice(1).join(" ") || firstName,
			dateOfBirth || user.kyc?.dateOfBirth?.toISOString().split("T")[0],
			expiryDate,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "Passport verification failed",
			});
		}

		user.kyc = user.kyc || {};
		user.kyc.identification = {
			type: "passport",
			number: passportNumber,
		};
		user.kyc.isVerified = result.verified || user.kyc.isVerified;
		user.kyc.verifiedAt = result.verified ? new Date() : user.kyc.verifiedAt;

		await user.save();

		if (result.verified) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			verified: result.verified,
			message: result.verified
				? "Passport verified successfully"
				: "Passport verification pending",
			data: result.data,
		});
	} catch (error) {
		console.error("❌ Passport verification error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/*
|--------------------------------------------------------------------------
| Verify Driver's License
|--------------------------------------------------------------------------
*/
export const verifyDriversLicense = async (req, res) => {
	try {
		const userId = req.user._id;
		const { licenseNumber, dateOfBirth } = req.body;

		if (!licenseNumber) {
			return res.status(400).json({
				success: false,
				error: "Driver's license number is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const result = await dojahService.verifyDriversLicense(
			licenseNumber,
			dateOfBirth || user.kyc?.dateOfBirth?.toISOString().split("T")[0],
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "Driver's license verification failed",
			});
		}

		user.kyc = user.kyc || {};
		user.kyc.identification = {
			type: "driver_license",
			number: licenseNumber,
		};
		user.kyc.isVerified = result.verified || user.kyc.isVerified;
		user.kyc.verifiedAt = result.verified ? new Date() : user.kyc.verifiedAt;

		await user.save();

		if (result.verified) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			verified: result.verified,
			message: result.verified
				? "Driver's license verified successfully"
				: "Verification pending",
			data: result.data,
		});
	} catch (error) {
		console.error("❌ Driver's license verification error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/*
|--------------------------------------------------------------------------
| Verify Proof of Address with Dojah
|--------------------------------------------------------------------------
*/
export const verifyAddress = async (req, res) => {
	try {
		const userId = req.user._id;
		const { imageUrl, address } = req.body;

		if (!imageUrl) {
			return res.status(400).json({
				success: false,
				error: "Address document image is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const result = await dojahService.verifyAddress(
			imageUrl,
			address || user.kyc?.address?.street,
			user.fullName,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "Address verification failed",
			});
		}

		// Save address verification result
		user.kyc = user.kyc || {};
		user.kyc.address = {
			street: result.address || user.kyc.address?.street,
			city: user.kyc.address?.city || "",
			state: user.kyc.address?.state || "",
			country: "NG",
		};
		user.kyc.isVerified = result.verified || user.kyc.isVerified;
		user.kyc.verifiedAt = result.verified ? new Date() : user.kyc.verifiedAt;

		await user.save();

		if (result.verified) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			verified: result.verified,
			message: result.verified
				? "Address verified successfully"
				: "Address verification pending",
			confidence: result.confidence,
			address: result.address,
		});
	} catch (error) {
		console.error("❌ Address verification error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/*
|--------------------------------------------------------------------------
| Liveness Check with Dojah
|--------------------------------------------------------------------------
*/
export const verifyLiveness = async (req, res) => {
	try {
		const userId = req.user._id;
		const { selfieImage, idImage } = req.body;

		if (!selfieImage) {
			return res.status(400).json({
				success: false,
				error: "Selfie image is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Get ID image from user's KYC or use provided
		const idImageUrl = idImage || user.kyc?.identification?.imageUrl;

		if (!idImageUrl) {
			return res.status(400).json({
				success: false,
				error:
					"ID image is required for liveness check. Please upload your ID first.",
			});
		}

		const result = await dojahService.livenessCheck(selfieImage, idImageUrl);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "Liveness check failed",
			});
		}

		// Save liveness check result
		user.kyc = user.kyc || {};
		user.kyc.isVerified = result.passed || user.kyc.isVerified;
		user.kyc.verifiedAt = result.passed ? new Date() : user.kyc.verifiedAt;

		await user.save();

		if (result.passed) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			passed: result.passed,
			message: result.passed
				? "Liveness check passed"
				: "Liveness check failed",
			confidence: result.confidence,
			isReal: result.isReal,
			antiSpoofing: result.antiSpoofing,
		});
	} catch (error) {
		console.error("❌ Liveness check error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/*
|--------------------------------------------------------------------------
| Complete KYC Verification (All-in-one)
|--------------------------------------------------------------------------
*/
export const completeKYC = async (req, res) => {
	try {
		const userId = req.user._id;
		const { nin, bvn, dateOfBirth, gender, address, idType, idNumber } =
			req.body;

		console.log("🔵 Complete KYC Request:", { userId, dateOfBirth });

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Initialize KYC object
		user.kyc = user.kyc || {};
		user.kyc.address = user.kyc.address || {};
		user.kyc.identification = user.kyc.identification || {};

		let verificationResults = {
			ninVerified: false,
			bvnVerified: false,
			addressVerified: false,
			idVerified: false,
			isVerified: false,
		};

		// 1. Verify NIN if provided
		if (nin && nin.length === 11) {
			const ninResult = await dojahService.verifyNIN(
				nin,
				user.fullName.split(" ")[0],
				user.fullName.split(" ").slice(1).join(" ") || user.fullName,
				dateOfBirth || user.kyc?.dateOfBirth?.toISOString().split("T")[0],
			);
			if (ninResult.success && ninResult.verified) {
				verificationResults.ninVerified = true;
				user.kyc.bvn = nin;
				user.kyc.bvnVerified = true;
				// Update date of birth from NIN verification
				if (ninResult.dateOfBirth) {
					user.kyc.dateOfBirth = new Date(ninResult.dateOfBirth);
				} else if (dateOfBirth) {
					user.kyc.dateOfBirth = new Date(dateOfBirth);
				}
			}
		}

		// 2. Verify BVN if provided
		if (bvn && bvn.length === 11 && !verificationResults.ninVerified) {
			const bvnResult = await dojahService.verifyBVN(
				bvn,
				dateOfBirth || user.kyc?.dateOfBirth?.toISOString().split("T")[0],
				user.phoneNumber,
			);
			if (bvnResult.success && bvnResult.verified) {
				verificationResults.bvnVerified = true;
				user.kyc.bvn = bvn;
				user.kyc.bvnVerified = true;
				if (bvnResult.dateOfBirth) {
					user.kyc.dateOfBirth = new Date(bvnResult.dateOfBirth);
				} else if (dateOfBirth) {
					user.kyc.dateOfBirth = new Date(dateOfBirth);
				}
				if (bvnResult.gender) {
					user.kyc.gender = bvnResult.gender;
				}
			}
		}

		// 3. If no verification was done but dateOfBirth is provided, save it
		if (
			dateOfBirth &&
			!verificationResults.ninVerified &&
			!verificationResults.bvnVerified
		) {
			user.kyc.dateOfBirth = new Date(dateOfBirth);
		}

		// 4. Verify Address
		if (address?.street) {
			verificationResults.addressVerified = true;
			user.kyc.address = {
				street: address.street,
				city: address.city || user.kyc.address?.city || "",
				state: address.state || user.kyc.address?.state || "",
				country: address.country || "NG",
				postalCode: address.postalCode || user.kyc.address?.postalCode || "",
			};
		}

		// 5. Verify ID
		if (idType && idNumber) {
			verificationResults.idVerified = true;
			user.kyc.identification = {
				type: idType,
				number: idNumber,
				imageUrl: user.kyc.identification?.imageUrl || "",
			};
		}

		// 6. Set gender if provided
		if (gender) {
			user.kyc.gender = gender;
		}

		// Check if all verifications passed
		const hasRequiredKYC =
			(verificationResults.ninVerified || verificationResults.bvnVerified) &&
			verificationResults.addressVerified &&
			verificationResults.idVerified;

		user.kyc.isVerified = hasRequiredKYC;
		user.kyc.verifiedAt = hasRequiredKYC ? new Date() : null;

		// Also check if we have enough data for basic KYC completion
		const hasBasicKYC =
			!!user.kyc.bvn &&
			!!user.kyc.dateOfBirth &&
			!!user.kyc.address?.street &&
			!!user.kyc.address?.city &&
			!!user.kyc.address?.state &&
			!!user.kyc.identification?.type &&
			!!user.kyc.identification?.number;

		user.kyc.isComplete = hasBasicKYC || hasRequiredKYC;

		await user.save();

		// Create virtual account and register with Bridgecard if KYC is complete
		if (hasRequiredKYC || hasBasicKYC) {
			await createVirtualAccountForUser(userId);
			await registerWithBridgecard(userId);
		}

		res.status(200).json({
			success: true,
			kyc: {
				isVerified: user.kyc.isVerified,
				isComplete: user.kyc.isComplete,
				verificationResults,
				verifiedAt: user.kyc.verifiedAt,
				dateOfBirth: user.kyc.dateOfBirth
					? user.kyc.dateOfBirth.toISOString().split("T")[0]
					: null,
			},
		});
	} catch (error) {
		console.error("❌ Complete KYC error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

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

// backend/controllers/userController.js - Updated updateKYC with virtual account creation

export const updateKYC = async (req, res) => {
	try {
		const userId = req.user._id;
		const { bvn, dateOfBirth, gender, address, identification } = req.body;

		console.log("🔵 KYC Update Request Started");
		console.log("User ID:", userId);
		console.log("📤 Received data:", { bvn, dateOfBirth, gender, address });

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Initialize KYC if it doesn't exist
		if (!user.kyc) {
			user.kyc = {};
		}
		if (!user.kyc.address) {
			user.kyc.address = {};
		}
		if (!user.kyc.identification) {
			user.kyc.identification = {};
		}

		// Update KYC fields if provided
		let kycUpdated = false;

		// Update BVN
		if (bvn) {
			user.kyc.bvn = bvn;
			kycUpdated = true;
		}

		// Update Date of Birth - CRITICAL FIX
		if (dateOfBirth) {
			try {
				const dobDate = new Date(dateOfBirth);
				if (!isNaN(dobDate.getTime())) {
					user.kyc.dateOfBirth = dobDate;
					kycUpdated = true;
					console.log("✅ Date of Birth updated to:", dobDate);
				} else {
					console.log("⚠️ Invalid date format:", dateOfBirth);
				}
			} catch (err) {
				console.log("⚠️ Error parsing date:", err);
			}
		}

		// Update Gender
		if (gender) {
			user.kyc.gender = gender;
			kycUpdated = true;
		}

		// Update Address
		if (address) {
			if (address.street) {
				user.kyc.address.street = address.street;
				kycUpdated = true;
			}
			if (address.city) {
				user.kyc.address.city = address.city;
				kycUpdated = true;
			}
			if (address.state) {
				user.kyc.address.state = address.state;
				kycUpdated = true;
			}
			if (address.country) {
				user.kyc.address.country = address.country;
				kycUpdated = true;
			}
			if (address.postalCode) {
				user.kyc.address.postalCode = address.postalCode;
				kycUpdated = true;
			}
		}

		// Update Identification
		if (identification) {
			if (identification.type) {
				user.kyc.identification.type = identification.type;
				kycUpdated = true;
			}
			if (identification.number) {
				user.kyc.identification.number = identification.number;
				kycUpdated = true;
			}
			if (identification.imageUrl) {
				user.kyc.identification.imageUrl = identification.imageUrl;
				kycUpdated = true;
			}
		}

		// Check if KYC is complete
		const isKYCComplete =
			!!user.kyc.bvn &&
			!!user.kyc.dateOfBirth &&
			!!user.kyc.address?.street &&
			!!user.kyc.address?.city &&
			!!user.kyc.address?.state &&
			!!user.kyc.identification?.type &&
			!!user.kyc.identification?.number;

		if (isKYCComplete) {
			user.kyc.isComplete = true;
			user.kyc.isVerified = true;
			user.kyc.verifiedAt = new Date();
		} else {
			user.kyc.isComplete = false;
		}

		// Save user changes
		if (kycUpdated || isKYCComplete) {
			await user.save();
			console.log("✅ User KYC updated successfully");
			console.log("📊 Current KYC state:", {
				bvn: user.kyc.bvn,
				dateOfBirth: user.kyc.dateOfBirth,
				address: user.kyc.address,
				identification: user.kyc.identification,
				isComplete: user.kyc.isComplete,
				isVerified: user.kyc.isVerified,
			});
		} else {
			console.log("ℹ️ No KYC fields to update");
		}

		// Return KYC status
		const kycStatus = {
			isVerified: user.kyc.isVerified || false,
			isComplete: isKYCComplete,
			pendingValidation: user.kyc.pendingValidation || false,
			hasBvn: !!user.kyc.bvn,
			hasDateOfBirth: !!user.kyc.dateOfBirth,
			hasAddress: !!(
				user.kyc.address?.street &&
				user.kyc.address?.city &&
				user.kyc.address?.state
			),
			hasIdentification: !!(
				user.kyc.identification?.type && user.kyc.identification?.number
			),
			verifiedAt: user.kyc.verifiedAt || null,
			// Include the actual values for frontend display
			bvn: user.kyc.bvn,
			dateOfBirth: user.kyc.dateOfBirth,
			gender: user.kyc.gender,
			address: user.kyc.address,
			identification: user.kyc.identification,
		};

		return res.status(200).json({
			success: true,
			message: isKYCComplete
				? "KYC completed successfully"
				: "KYC data updated",
			kyc: kycStatus,
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
 * Helper function to create virtual account for user
 * ✅ REAL ANCHOR ONLY - No mock fallback
 */
// backend/controllers/userController.js - Updated createVirtualAccountForUser

export const createVirtualAccountForUser = async (userId) => {
	try {
		console.log("🏦 Creating virtual account for user:", userId);

		// Check if user already has a virtual account
		const existingAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (existingAccount) {
			console.log(
				"✅ User already has virtual account:",
				existingAccount.accountNumber,
			);
			return {
				success: true,
				account: existingAccount,
				message: "Virtual account already exists",
			};
		}

		// Get Anchor customer
		let anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			console.log("❌ No Anchor customer found for user:", userId);
			const { getOrCreateAnchorCustomer } =
				await import("../services/anchorCustomerService.js");
			const result = await getOrCreateAnchorCustomer(userId);
			if (!result.success) {
				return { success: false, error: "Could not create Anchor customer" };
			}
			anchorCustomer = await AnchorCustomer.findOne({ userId });
			if (!anchorCustomer) {
				return { success: false, error: "Anchor customer creation failed" };
			}
		}

		console.log(`✅ Anchor customer found: ${anchorCustomer.anchorCustomerId}`);
		console.log(`   Local KYC Level: ${anchorCustomer.kycLevel}`);

		// Get user details
		const user = await User.findById(userId);
		if (!user) {
			return { success: false, error: "User not found" };
		}

		// ✅ CRITICAL: Check if KYC needs to be upgraded in Anchor
		if (anchorCustomer.kycLevel === "TIER_0") {
			console.log("⚠️ KYC not completed in Anchor. Attempting to upgrade...");

			const bvn = user.kyc?.bvn;
			const dateOfBirth = user.kyc?.dateOfBirth;
			const gender = user.kyc?.gender;

			if (!bvn || !dateOfBirth || !gender) {
				console.log("❌ Missing KYC data:", {
					bvn: !!bvn,
					dateOfBirth: !!dateOfBirth,
					gender: !!gender,
				});
				return {
					success: false,
					error: "KYC data incomplete. Please complete your KYC first.",
					requiresKYC: true,
				};
			}

			const formattedDate =
				dateOfBirth instanceof Date
					? dateOfBirth.toISOString().split("T")[0]
					: new Date(dateOfBirth).toISOString().split("T")[0];

			console.log(
				`📤 Upgrading KYC in Anchor: BVN=${bvn}, DOB=${formattedDate}, Gender=${gender}`,
			);

			const upgradeResult = await anchorService.upgradeCustomerKYC(
				anchorCustomer.anchorCustomerId,
				bvn,
				formattedDate,
				gender,
			);

			if (!upgradeResult.success) {
				console.error("❌ KYC upgrade failed:", upgradeResult.error);
				return {
					success: false,
					error: upgradeResult.error || "Failed to upgrade KYC in Anchor",
					requiresKYC: true,
				};
			}

			console.log(`✅ KYC upgrade initiated: ${upgradeResult.verificationId}`);
			console.log(`   Status: ${upgradeResult.status}`);

			anchorCustomer.kycLevel = "TIER_1";
			anchorCustomer.kycStatus = "pending";
			anchorCustomer.currentVerificationId = upgradeResult.verificationId;
			anchorCustomer.identificationLevel2 = { bvn, dateOfBirth, gender };
			await anchorCustomer.save();

			user.anchorKycLevel = "TIER_1";
			user.kyc.anchorVerificationId = upgradeResult.verificationId;
			user.kyc.paystackValidationPending = true;
			await user.save();

			return {
				success: false,
				error:
					"KYC verification submitted. Please wait for approval before creating a virtual account.",
				requiresKYC: true,
				kycPending: true,
				verificationId: upgradeResult.verificationId,
			};
		}

		console.log(
			`✅ KYC Level ${anchorCustomer.kycLevel} - Proceeding with virtual account creation`,
		);

		// ✅ STEP 1: Check if account already exists in Anchor
		let depositAccountId = null;
		let existingAccountNumber = null;

		try {
			console.log("🔍 Checking for existing deposit accounts in Anchor...");
			const accountsResponse = await anchorService.getDepositAccounts(
				anchorCustomer.anchorCustomerId,
			);

			if (accountsResponse.success && accountsResponse.accounts?.length > 0) {
				const existingAcc = accountsResponse.accounts[0];
				depositAccountId = existingAcc.id || existingAcc.accountId;
				console.log(`✅ Found existing deposit account: ${depositAccountId}`);

				// Try to get account number for existing account
				try {
					const accountNumberResponse =
						await anchorService.getAccountNumberForDeposit(depositAccountId);
					if (accountNumberResponse.success) {
						existingAccountNumber = accountNumberResponse.accountNumber;
						console.log(
							`✅ Found existing account number: ${existingAccountNumber}`,
						);
					}
				} catch (err) {
					console.log(
						"⚠️ Could not get account number for existing account:",
						err.message,
					);
				}
			}
		} catch (err) {
			console.log("⚠️ Could not check existing accounts:", err.message);
		}

		// ✅ STEP 2: Create deposit account if none exists
		if (!depositAccountId) {
			console.log("📝 Creating new deposit account in Anchor...");

			const accountResponse = await anchorService.createDepositAccount(
				anchorCustomer.anchorCustomerId,
				"SAVINGS",
				{
					userId: userId.toString(),
					platform: "kuditrak",
					currency: "NGN",
					created_after_kyc: true,
				},
			);

			if (!accountResponse.success) {
				console.error(
					"❌ Failed to create deposit account:",
					accountResponse.error,
				);
				return {
					success: false,
					error:
						accountResponse.error ||
						"Failed to create deposit account in Anchor",
				};
			}

			depositAccountId = accountResponse.accountId;
			console.log(`✅ Deposit account created: ${depositAccountId}`);
		}

		// ✅ STEP 3: Get account number using the correct endpoint
		let accountNumber = existingAccountNumber;
		let bankName = "Anchor Bank";
		let accountName = user.fullName;

		if (!accountNumber) {
			console.log(
				"📝 Getting account number for deposit account:",
				depositAccountId,
			);

			const accountNumberResponse =
				await anchorService.getAccountNumberForDeposit(depositAccountId);

			if (!accountNumberResponse.success) {
				console.error(
					"❌ Failed to get account number:",
					accountNumberResponse.error,
				);

				// Try the alternative method: get account details with include
				try {
					console.log("📝 Trying alternative method to get account number...");
					const accountDetails =
						await anchorService.getDepositAccount(depositAccountId);
					if (accountDetails.success && accountDetails.account) {
						accountNumber = accountDetails.account.accountNumber;
						bankName = accountDetails.account.bankName || "Anchor Bank";
						console.log(
							`✅ Account number retrieved via include: ${accountNumber}`,
						);
					}
				} catch (err) {
					console.log("⚠️ Alternative method also failed:", err.message);
				}

				if (!accountNumber) {
					return {
						success: false,
						error:
							accountNumberResponse.error ||
							"Failed to get account number from Anchor",
					};
				}
			} else {
				accountNumber = accountNumberResponse.accountNumber;
				bankName = accountNumberResponse.bankName || "Anchor Bank";
				accountName = accountNumberResponse.accountName || user.fullName;
				console.log(`✅ Account number retrieved: ${accountNumber}`);
			}
		}

		// ✅ STEP 4: Save to database
		const virtualAccount = await AnchorVirtualAccount.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: null,
			accountNumber: accountNumber,
			bankName: bankName,
			bankCode: "000",
			accountName: accountName,
			anchorReference: depositAccountId,
			isActive: true,
			isMock: false,
			provider: "anchor",
			currency: "NGN",
		});

		console.log(`✅ Virtual account saved: ${virtualAccount.accountNumber}`);

		// ✅ STEP 5: Create or update wallet with REAL Anchor data
		let wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			wallet = await AnchorWallet.create({
				userId,
				anchorCustomerId: anchorCustomer.anchorCustomerId,
				walletId: depositAccountId, // ✅ Use the REAL Anchor deposit account ID
				walletType: "main",
				balance: 0,
				name: "Main Wallet",
				currency: "NGN",
				status: "active",
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				isLocal: false,
			});
			console.log(`✅ Wallet created with Anchor ID: ${wallet.walletId}`);
		} else {
			wallet.walletId = depositAccountId;
			wallet.accountNumber = virtualAccount.accountNumber;
			wallet.bankName = virtualAccount.bankName;
			wallet.isLocal = false;
			await wallet.save();
			console.log("✅ Wallet updated with Anchor data");
		}

		// ✅ STEP 6: Send notification
		try {
			await sendPushToUser(
				userId,
				"🏦 Virtual Account Ready",
				`Your virtual account ${virtualAccount.accountNumber} (${virtualAccount.bankName}) is ready to receive money.`,
				{
					type: "virtual_account_created",
					accountNumber: virtualAccount.accountNumber,
					bankName: virtualAccount.bankName,
				},
			);
		} catch (pushError) {
			console.log("⚠️ Push notification error:", pushError.message);
		}

		console.log("✅ Virtual account setup complete!");

		return {
			success: true,
			account: virtualAccount,
			accountNumber: virtualAccount.accountNumber,
			bankName: virtualAccount.bankName,
		};
	} catch (error) {
		console.error("❌ Create virtual account error:", error);
		return { success: false, error: error.message };
	}
};

// backend/controllers/userController.js - Add this function

/**
 * Manually submit KYC to Anchor for verification
 */
export const submitKYCToAnchor = async (req, res) => {
	try {
		const userId = req.user._id;
		console.log("🔵 Submitting KYC to Anchor for user:", userId);

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ success: false, error: "User not found" });
		}

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete onboarding first.",
			});
		}

		// Check if KYC is already TIER_1 or higher
		if (anchorCustomer.kycLevel !== "TIER_0") {
			return res.status(200).json({
				success: true,
				message: `KYC already at level ${anchorCustomer.kycLevel}`,
				kyc: {
					level: anchorCustomer.kycLevel,
					status: anchorCustomer.kycStatus,
				},
			});
		}

		// Get KYC data from user
		const bvn = user.kyc?.bvn;
		const dateOfBirth = user.kyc?.dateOfBirth;
		const gender = user.kyc?.gender;

		if (!bvn || !dateOfBirth || !gender) {
			return res.status(400).json({
				success: false,
				error: "Missing KYC data. Please complete your KYC first.",
				missing: {
					bvn: !bvn,
					dateOfBirth: !dateOfBirth,
					gender: !gender,
				},
			});
		}

		const formattedDate =
			dateOfBirth instanceof Date
				? dateOfBirth.toISOString().split("T")[0]
				: new Date(dateOfBirth).toISOString().split("T")[0];

		console.log(
			`📤 Upgrading KYC in Anchor: BVN=${bvn}, DOB=${formattedDate}, Gender=${gender}`,
		);

		// Upgrade KYC in Anchor
		const upgradeResult = await anchorService.upgradeCustomerKYC(
			anchorCustomer.anchorCustomerId,
			bvn,
			formattedDate,
			gender,
		);

		if (!upgradeResult.success) {
			console.error("❌ KYC upgrade failed:", upgradeResult.error);
			return res.status(400).json({
				success: false,
				error: upgradeResult.error || "Failed to upgrade KYC in Anchor",
			});
		}

		// Update local records
		anchorCustomer.kycLevel = "TIER_1";
		anchorCustomer.kycStatus = "pending";
		anchorCustomer.currentVerificationId = upgradeResult.verificationId;
		anchorCustomer.identificationLevel2 = { bvn, dateOfBirth, gender };
		await anchorCustomer.save();

		user.anchorKycLevel = "TIER_1";
		user.kyc.anchorVerificationId = upgradeResult.verificationId;
		user.kyc.paystackValidationPending = true;
		await user.save();

		res.status(200).json({
			success: true,
			message: "KYC submitted to Anchor for verification",
			verificationId: upgradeResult.verificationId,
			status: upgradeResult.status,
		});
	} catch (error) {
		console.error("Submit KYC to Anchor error:", error);
		res.status(500).json({ error: error.message });
	}
};
// backend/controllers/userController.js - Add this function

export const getVirtualAccountDetails = async (req, res) => {
	try {
		const userId = req.user._id;

		// Check for virtual account
		let virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (!virtualAccount) {
			// Try to create one
			const result = await createVirtualAccountForUser(userId);
			if (!result.success) {
				return res.status(404).json({
					success: false,
					error: result.error || "No virtual account found",
					requiresKYC: result.requiresKYC || false,
				});
			}
			virtualAccount = result.account;
		}

		// Get fresh data from Anchor
		let balance = 0;
		let accountNumber = virtualAccount.accountNumber;
		let bankName = virtualAccount.bankName;

		if (virtualAccount.anchorReference) {
			try {
				// Get balance
				const balanceResponse = await anchorService.getWalletBalance(
					virtualAccount.anchorReference,
				);
				if (balanceResponse.success) {
					balance = balanceResponse.balance;
				}

				// Get account details
				const accountDetails = await anchorService.getDepositAccount(
					virtualAccount.anchorReference,
				);
				if (accountDetails.success && accountDetails.account) {
					if (accountDetails.account.accountNumber) {
						accountNumber = accountDetails.account.accountNumber;
						virtualAccount.accountNumber = accountNumber;
						await virtualAccount.save();
					}
					if (accountDetails.account.bankName) {
						bankName = accountDetails.account.bankName;
						virtualAccount.bankName = bankName;
						await virtualAccount.save();
					}
				}
			} catch (err) {
				console.log("⚠️ Could not fetch fresh account details:", err.message);
			}
		}

		res.status(200).json({
			success: true,
			account: {
				id: virtualAccount._id,
				accountNumber: accountNumber,
				bankName: bankName,
				accountName: virtualAccount.accountName,
				balance: balance,
				isActive: virtualAccount.isActive,
				currency: virtualAccount.currency || "NGN",
			},
		});
	} catch (error) {
		console.error("❌ Get virtual account details error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
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

		console.log("📊 Fetching KYC status for user:", userId);
		console.log("📊 User KYC data:", user.kyc);

		// Check if KYC is complete
		const isKYCComplete =
			!!user.kyc?.bvn &&
			!!user.kyc?.dateOfBirth &&
			!!user.kyc?.address?.street &&
			!!user.kyc?.address?.city &&
			!!user.kyc?.address?.state &&
			!!user.kyc?.identification?.type &&
			!!user.kyc?.identification?.number;

		const kycStatus = {
			isVerified: user.kyc?.isVerified || false,
			isComplete: isKYCComplete,
			pendingValidation: user.kyc?.pendingValidation || false,
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
			// Include actual values for frontend
			bvn: user.kyc?.bvn || undefined,
			dateOfBirth: user.kyc?.dateOfBirth
				? user.kyc.dateOfBirth.toISOString().split("T")[0]
				: undefined,
			gender: user.kyc?.gender || undefined,
			address: user.kyc?.address || {},
			identification: user.kyc?.identification || {},
		};

		console.log("📊 Returning KYC status:", kycStatus);

		res.status(200).json({
			success: true,
			kyc: kycStatus,
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

// backend/controllers/userController.js

/**
 * Search for Kuditrak users by name, email, or phone number
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const searchKuditrakUsers = async (req, res) => {
	try {
		const userId = req.user._id;
		const { q } = req.query;

		// Validate search query
		if (!q || q.trim().length < 2) {
			return res.status(400).json({
				success: false,
				error: "Search query must be at least 2 characters",
			});
		}

		const searchTerm = q.trim();
		const searchRegex = new RegExp(searchTerm, "i");

		// Search for users excluding the current user
		const users = await User.find({
			_id: { $ne: userId }, // Exclude self
			$or: [
				{ fullName: searchRegex },
				{ email: searchRegex },
				{ phoneNumber: searchRegex },
			],
		})
			.select("_id fullName email phoneNumber profileImage") // Only return necessary fields
			.limit(20) // Limit results
			.lean();

		// Format the response
		const formattedUsers = users.map((user) => ({
			id: user._id,
			name: user.fullName,
			email: user.email,
			phoneNumber: user.phoneNumber,
			profileImage: user.profileImage || null,
		}));

		res.status(200).json({
			success: true,
			users: formattedUsers,
			count: formattedUsers.length,
		});
	} catch (error) {
		console.error("❌ Search Kuditrak users error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to search users",
		});
	}
};
