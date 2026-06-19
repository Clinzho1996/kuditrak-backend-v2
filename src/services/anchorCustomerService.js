// backend/services/anchorCustomerService.js
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import anchorService from "../services/anchorService.js";
import {
	formatDateForAnchor,
	isValidBVN,
	splitFullName,
} from "../utils/anchorHelper.js";

// backend/services/anchorCustomerService.js - Fix phone number generation

// backend/services/anchorCustomerService.js - Updated to use real KYC data

export const getOrCreateAnchorCustomer = async (userId) => {
	try {
		// Check if user already has an Anchor customer
		let anchorCustomer = await AnchorCustomer.findOne({ userId });

		if (anchorCustomer) {
			return {
				success: true,
				anchorCustomer,
				customerId: anchorCustomer.anchorCustomerId,
				isNew: false,
			};
		}

		// Get user details
		const user = await User.findById(userId);
		if (!user) {
			return { success: false, error: "User not found" };
		}

		// ✅ LOG the actual user data
		console.log("👤 User Data from DB:", {
			fullName: user.fullName,
			email: user.email,
			phoneNumber: user.phoneNumber,
			hasKYC: !!user.kyc,
			kycAddress: user.kyc?.address,
			hasIdentification: !!user.kyc?.identification,
			hasBVN: !!user.kyc?.bvn,
			hasDOB: !!user.kyc?.dateOfBirth,
			hasGender: !!user.kyc?.gender,
		});

		// Parse full name
		const { firstName, lastName, middleName, maidenName } = splitFullName(
			user.fullName,
		);

		// ✅ USE REAL ADDRESS from user's KYC data
		const address = {
			addressLine_1: user.kyc?.address?.street || "123 Test Street",
			addressLine_2: null,
			city: user.kyc?.address?.city || "Lagos",
			state: user.kyc?.address?.state || "Lagos",
			postalCode: user.kyc?.address?.postalCode || "100001",
			country: user.kyc?.address?.country || "NG",
		};

		console.log("📍 Using address from DB:", address);

		// ✅ USE REAL PHONE NUMBER from user
		const phoneNumber = user.phoneNumber || "08000000000";
		console.log("📞 Using phone number from DB:", phoneNumber);

		// ✅ CHECK for REAL KYC Level 2 data
		const hasKYCLevel2 =
			user.kyc?.bvn && user.kyc?.dateOfBirth && user.kyc?.gender;

		console.log("🔐 Has KYC Level 2 data:", hasKYCLevel2);
		if (hasKYCLevel2) {
			console.log("   BVN:", user.kyc.bvn);
			console.log("   DOB:", user.kyc.dateOfBirth);
			console.log("   Gender:", user.kyc.gender);
		}

		let anchorResponse;

		if (hasKYCLevel2 && isValidBVN(user.kyc.bvn)) {
			console.log("📝 Creating customer with REAL KYC Level 2 (Tier 1)");

			// ✅ USE REAL KYC DATA from user
			anchorResponse = await anchorService.createAnchorCustomerWithKYC({
				firstName,
				lastName,
				middleName,
				maidenName,
				email: user.email,
				phoneNumber: phoneNumber, // ✅ Use real phone
				address: address, // ✅ Use real address
				bvn: user.kyc.bvn, // ✅ Use real BVN
				dateOfBirth: formatDateForAnchor(user.kyc.dateOfBirth),
				gender: user.kyc.gender, // ✅ Use real gender
				metadata: {
					userId: user._id.toString(),
					platform: "kuditrak",
					version: "2.0",
					source: "kyc_data",
				},
			});
		} else {
			console.log("📝 Creating customer as Tier 0 (no KYC data found)");
			anchorResponse = await anchorService.createAnchorCustomer({
				firstName,
				lastName,
				middleName,
				maidenName,
				email: user.email,
				phoneNumber: phoneNumber,
				address: address,
				metadata: {
					userId: user._id.toString(),
					platform: "kuditrak",
					version: "2.0",
				},
			});
		}

		if (!anchorResponse.success) {
			// If error is "Email already exists", try to link existing customer
			if (anchorResponse.error?.includes("Email already exist")) {
				console.log(
					"⚠️ Email already exists in Anchor. Attempting to link existing customer...",
				);
				return await linkExistingAnchorCustomer(user);
			}
			return { success: false, error: anchorResponse.error };
		}

		// Save Anchor customer to database
		anchorCustomer = await AnchorCustomer.create({
			userId,
			anchorCustomerId: anchorResponse.customerId,
			fullName: { firstName, lastName, middleName, maidenName },
			email: user.email,
			phoneNumber: phoneNumber,
			address: address,
			kycLevel: hasKYCLevel2 ? "TIER_1" : "TIER_0",
			kycStatus: hasKYCLevel2 ? "pending" : "pending",
			identificationLevel2: hasKYCLevel2
				? {
						bvn: user.kyc.bvn,
						dateOfBirth: user.kyc.dateOfBirth,
						gender: user.kyc.gender,
					}
				: {},
			metadata: { userId: user._id.toString() },
		});

		// Update user with anchor customer ID
		user.anchorCustomerId = anchorResponse.customerId;
		user.anchorCustomerStatus = "active";
		user.anchorKycLevel = hasKYCLevel2 ? "TIER_1" : "TIER_0";
		await user.save();

		// Create default wallet
		const walletResponse = await anchorService.createAnchorWallet(
			anchorResponse.customerId,
			"Main Wallet",
			{ userId: user._id.toString(), type: "main" },
		);

		if (walletResponse.success) {
			await AnchorWallet.create({
				userId,
				anchorCustomerId: anchorResponse.customerId,
				walletId: walletResponse.walletId,
				walletType: "main",
				balance: 0,
				name: "Main Wallet",
				currency: "NGN",
				status: "active",
			});
		}

		return {
			success: true,
			anchorCustomer,
			customerId: anchorResponse.customerId,
			isNew: true,
		};
	} catch (error) {
		console.error("Get or create Anchor customer error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Link existing Anchor customer to user (when email already exists)
 */
const linkExistingAnchorCustomer = async (user) => {
	try {
		console.log("🔗 Linking existing Anchor customer for user:", user.email);

		// We need to find the existing Anchor customer ID
		// Since we can't search by email directly, we'll create a temporary customer
		// and catch the error to get the existing ID, or use the user's existing anchorCustomerId

		// Check if user already has an anchorCustomerId
		if (user.anchorCustomerId) {
			console.log(
				"✅ User already has anchorCustomerId:",
				user.anchorCustomerId,
			);

			// Create local record
			const anchorCustomer = await AnchorCustomer.create({
				userId: user._id,
				anchorCustomerId: user.anchorCustomerId,
				fullName: {
					firstName: user.fullName.split(" ")[0],
					lastName:
						user.fullName.split(" ").slice(1).join(" ") || user.fullName,
				},
				email: user.email,
				phoneNumber: user.phoneNumber || "08000000000",
				address: {
					addressLine_1: user.kyc?.address?.street || "Unknown Street",
					city: user.kyc?.address?.city || "Lagos",
					state: user.kyc?.address?.state || "Lagos",
					postalCode: user.kyc?.address?.postalCode || "000000",
					country: user.kyc?.address?.country || "NG",
				},
				kycLevel: user.anchorKycLevel || "TIER_0",
				kycStatus: "pending",
				metadata: { userId: user._id.toString() },
			});

			return {
				success: true,
				anchorCustomer,
				customerId: user.anchorCustomerId,
				isNew: false,
			};
		}

		// If no anchorCustomerId, try to find by creating a customer with a unique email
		// This is a workaround - in production, you'd want a proper way to find existing customers
		const uniqueEmail = `temp_${Date.now()}_${user.email}`;
		const tempPayload = {
			firstName: user.fullName.split(" ")[0],
			lastName: user.fullName.split(" ").slice(1).join(" ") || user.fullName,
			email: uniqueEmail,
			phoneNumber: user.phoneNumber || "08000000000",
			address: {
				addressLine_1: user.kyc?.address?.street || "Unknown Street",
				city: user.kyc?.address?.city || "Lagos",
				state: user.kyc?.address?.state || "Lagos",
				postalCode: user.kyc?.address?.postalCode || "000000",
				country: user.kyc?.address?.country || "NG",
			},
		};

		// Try to create with unique email
		const response = await anchorService.createAnchorCustomer(tempPayload);

		if (response.success) {
			// Created successfully with temp email - now update with real email
			// This might not work if the real email is already taken, but we'll try
			console.log("✅ Created temp customer, will try to update email");

			// Save the customer with the real email if possible
			const anchorCustomer = await AnchorCustomer.create({
				userId: user._id,
				anchorCustomerId: response.customerId,
				fullName: {
					firstName: user.fullName.split(" ")[0],
					lastName:
						user.fullName.split(" ").slice(1).join(" ") || user.fullName,
				},
				email: user.email,
				phoneNumber: user.phoneNumber || "08000000000",
				address: {
					addressLine_1: user.kyc?.address?.street || "Unknown Street",
					city: user.kyc?.address?.city || "Lagos",
					state: user.kyc?.address?.state || "Lagos",
					postalCode: user.kyc?.address?.postalCode || "000000",
					country: user.kyc?.address?.country || "NG",
				},
				kycLevel: "TIER_0",
				kycStatus: "pending",
				metadata: { userId: user._id.toString() },
			});

			user.anchorCustomerId = response.customerId;
			user.anchorCustomerStatus = "active";
			await user.save();

			return {
				success: true,
				anchorCustomer,
				customerId: response.customerId,
				isNew: true,
			};
		}

		return {
			success: false,
			error: "Could not link existing Anchor customer. Please contact support.",
		};
	} catch (error) {
		console.error("Link existing Anchor customer error:", error);
		return { success: false, error: error.message };
	}
};

export const upgradeCustomerToTier1 = async (
	userId,
	bvn,
	dateOfBirth,
	gender,
) => {
	try {
		// Validate BVN
		if (!isValidBVN(bvn)) {
			return {
				success: false,
				error: "Invalid BVN format. Must be 11 digits.",
			};
		}

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return {
				success: false,
				error: "Anchor customer not found. Please complete onboarding first.",
			};
		}

		const user = await User.findById(userId);
		if (!user) {
			return { success: false, error: "User not found" };
		}

		// Use the direct verification endpoint
		console.log("🔄 Attempting KYC verification...");
		const verificationResponse = await anchorService.verifyCustomerKYC(
			anchorCustomer.anchorCustomerId,
			bvn,
			formatDateForAnchor(dateOfBirth),
			gender,
		);

		if (!verificationResponse.success) {
			return { success: false, error: verificationResponse.error };
		}

		// Update local records
		anchorCustomer.kycLevel = "TIER_1";
		anchorCustomer.kycStatus = "pending";
		anchorCustomer.identificationLevel2 = { bvn, dateOfBirth, gender };
		anchorCustomer.currentVerificationId = verificationResponse.verificationId;
		await anchorCustomer.save();

		user.anchorKycLevel = "TIER_1";
		user.kyc.bvn = bvn;
		user.kyc.dateOfBirth = new Date(dateOfBirth);
		user.kyc.gender = gender;
		user.kyc.anchorVerificationId = verificationResponse.verificationId;
		user.kyc.paystackValidationPending = true;
		await user.save();

		return {
			success: true,
			message: "KYC verification initiated",
			verificationId: verificationResponse.verificationId,
			status: verificationResponse.status,
		};
	} catch (error) {
		console.error("Upgrade to Tier 1 error:", error);
		return { success: false, error: error.message };
	}
};
/**
 * Get customer KYC status
 */
export const getCustomerKYCStatus = async (userId) => {
	try {
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return { success: false, error: "Anchor customer not found" };
		}

		// Try to get fresh status from Anchor
		try {
			const customerResponse = await anchorService.getAnchorCustomer(
				anchorCustomer.anchorCustomerId,
			);

			if (customerResponse.success) {
				const attributes = customerResponse.customer.attributes;
				const kycLevel = attributes?.kycLevel || anchorCustomer.kycLevel;
				const kycStatus = attributes?.kycStatus || anchorCustomer.kycStatus;

				// Update local if changed
				if (kycLevel !== anchorCustomer.kycLevel) {
					anchorCustomer.kycLevel = kycLevel;
					await anchorCustomer.save();
				}
				if (kycStatus !== anchorCustomer.kycStatus) {
					anchorCustomer.kycStatus = kycStatus;
					await anchorCustomer.save();
				}

				return {
					success: true,
					kycLevel,
					kycStatus,
					isVerified: kycLevel === "TIER_1" || kycLevel === "TIER_2",
				};
			}
		} catch (apiError) {
			console.error(
				"Failed to fetch KYC status from Anchor:",
				apiError.message,
			);
		}

		// Fallback to local data
		return {
			success: true,
			kycLevel: anchorCustomer.kycLevel,
			kycStatus: anchorCustomer.kycStatus,
			isVerified:
				anchorCustomer.kycLevel === "TIER_1" ||
				anchorCustomer.kycLevel === "TIER_2",
		};
	} catch (error) {
		console.error("Get KYC status error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Get user's main wallet
 */
export const getUserMainWallet = async (userId) => {
	try {
		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return { success: false, error: "Main wallet not found" };
		}

		// Get real-time balance
		const balanceResponse = await anchorService.getWalletBalance(
			wallet.walletId,
		);
		if (balanceResponse.success) {
			wallet.balance = balanceResponse.balance;
			await wallet.save();
		}

		return {
			success: true,
			wallet,
			balance: wallet.balance,
		};
	} catch (error) {
		console.error("Get user main wallet error:", error);
		return { success: false, error: error.message };
	}
};

// backend/services/anchorCustomerService.js - Add this function

export const submitKYCForVerification = async (userId) => {
	try {
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return { success: false, error: "Anchor customer not found" };
		}

		// Get the KYC data from local DB
		const kycData = anchorCustomer.identificationLevel2;
		if (!kycData || !kycData.bvn) {
			return {
				success: false,
				error: "No KYC data found. Please update KYC first.",
			};
		}

		console.log("📝 Submitting KYC for verification:", {
			bvn: kycData.bvn,
			dateOfBirth: kycData.dateOfBirth,
			gender: kycData.gender,
		});

		// Call Anchor's verification endpoint
		const verificationResponse = await anchorService.verifyCustomerKYC(
			anchorCustomer.anchorCustomerId,
			kycData.bvn,
			formatDateForAnchor(kycData.dateOfBirth),
			kycData.gender,
		);

		if (!verificationResponse.success) {
			return { success: false, error: verificationResponse.error };
		}

		// Update local status
		anchorCustomer.kycStatus = "pending";
		anchorCustomer.currentVerificationId = verificationResponse.verificationId;
		await anchorCustomer.save();

		return {
			success: true,
			message: "KYC verification submitted",
			verificationId: verificationResponse.verificationId,
		};
	} catch (error) {
		console.error("Submit KYC verification error:", error);
		return { success: false, error: error.message };
	}
};

export default {
	getOrCreateAnchorCustomer,
	upgradeCustomerToTier1,
	getCustomerKYCStatus,
	submitKYCForVerification,
	getUserMainWallet,
};
