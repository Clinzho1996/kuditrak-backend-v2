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

		// Parse full name
		const { firstName, lastName, middleName, maidenName } = splitFullName(
			user.fullName,
		);

		// Prepare address
		const address = {
			addressLine_1: "Unknown Street",
			addressLine_2: null,
			city: "Lagos",
			state: "Lagos",
			postalCode: "000000",
			country: "NG",
		};

		// Generate a proper 11-digit phone number
		// Format: 080 + 8 digits (using timestamp or user ID numbers only)
		let phoneNumber;

		// Try to use user's existing phone number first
		if (user.phoneNumber && /^\d{11}$/.test(user.phoneNumber)) {
			phoneNumber = user.phoneNumber;
		} else {
			// Generate from user ID (convert to numbers only)
			const userIdStr = user._id.toString();
			// Take the last 8 digits (or pad with zeros)
			let numericSuffix = userIdStr.replace(/\D/g, "").slice(-8);
			if (numericSuffix.length < 8) {
				numericSuffix = numericSuffix.padStart(8, "0");
			}
			phoneNumber = `080${numericSuffix}`;
		}

		console.log(
			`📞 Using phone number: ${phoneNumber} (length: ${phoneNumber.length})`,
		);

		// Validate phone number format
		if (!/^\d{11}$/.test(phoneNumber)) {
			console.log(`⚠️ Invalid phone number format, generating new one...`);
			// Generate a timestamp-based phone number as fallback
			const timestamp = Date.now().toString().slice(-8);
			phoneNumber = `080${timestamp}`;
			console.log(`📞 New phone number: ${phoneNumber}`);
		}

		// Check if we have KYC Level 2 data
		const hasKYCLevel2 =
			user.kyc?.bvn && user.kyc?.dateOfBirth && user.kyc?.gender;

		let anchorResponse;
		let retryCount = 0;
		const maxRetries = 3;

		while (retryCount < maxRetries) {
			try {
				if (hasKYCLevel2 && isValidBVN(user.kyc.bvn)) {
					console.log("📝 Creating customer with KYC Level 2 (Tier 1)");
					anchorResponse = await anchorService.createAnchorCustomerWithKYC({
						firstName,
						lastName,
						middleName,
						maidenName,
						email: user.email,
						phoneNumber,
						address,
						bvn: user.kyc.bvn,
						dateOfBirth: formatDateForAnchor(user.kyc.dateOfBirth),
						gender: user.kyc.gender,
						metadata: {
							userId: user._id.toString(),
							platform: "kuditrak",
							version: "2.0",
						},
					});
				} else {
					console.log("📝 Creating customer as Tier 0 (no KYC)");
					anchorResponse = await anchorService.createAnchorCustomer({
						firstName,
						lastName,
						middleName,
						maidenName,
						email: user.email,
						phoneNumber,
						address,
						metadata: {
							userId: user._id.toString(),
							platform: "kuditrak",
							version: "2.0",
						},
					});
				}

				// If successful, break out of retry loop
				if (anchorResponse.success) {
					break;
				}

				// If error is about phone number, generate a new one and retry
				if (
					anchorResponse.error?.includes("phoneNumber") ||
					anchorResponse.error?.includes("PhoneNumber")
				) {
					retryCount++;
					if (retryCount < maxRetries) {
						// Generate a new random phone number
						const random = Math.floor(Math.random() * 90000000) + 10000000;
						phoneNumber = `080${random}`;
						console.log(
							`🔄 Retry ${retryCount}: Using new phone number: ${phoneNumber}`,
						);
						continue;
					}
				}

				break;
			} catch (retryError) {
				console.error(
					`❌ Attempt ${retryCount + 1} failed:`,
					retryError.message,
				);
				retryCount++;
				if (retryCount < maxRetries) {
					const random = Math.floor(Math.random() * 90000000) + 10000000;
					phoneNumber = `080${random}`;
					console.log(
						`🔄 Retry ${retryCount}: Using new phone number: ${phoneNumber}`,
					);
				} else {
					throw retryError;
				}
			}
		}

		if (!anchorResponse || !anchorResponse.success) {
			return {
				success: false,
				error: anchorResponse?.error || "Failed to create customer",
			};
		}

		// Save Anchor customer to database
		anchorCustomer = await AnchorCustomer.create({
			userId,
			anchorCustomerId: anchorResponse.customerId,
			fullName: { firstName, lastName, middleName, maidenName },
			email: user.email,
			phoneNumber,
			address,
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

		// Update user with anchor customer ID and phone number
		user.anchorCustomerId = anchorResponse.customerId;
		user.anchorCustomerStatus = "active";
		user.anchorKycLevel = hasKYCLevel2 ? "TIER_1" : "TIER_0";
		user.phoneNumber = phoneNumber; // Save the generated phone number
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
		} else {
			console.error("Failed to create default wallet:", walletResponse.error);
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
