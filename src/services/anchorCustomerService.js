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

// backend/services/anchorCustomerService.js - Updated with better handling

export const getOrCreateAnchorCustomer = async (userId) => {
	try {
		// Check if user already has an Anchor customer in local DB
		let anchorCustomer = await AnchorCustomer.findOne({ userId });

		if (anchorCustomer) {
			console.log(
				`✅ Found existing Anchor customer in local DB: ${anchorCustomer.anchorCustomerId}`,
			);
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

		// Use real address from user's KYC data
		const address = {
			addressLine_1: user.kyc?.address?.street || "123 Test Street",
			addressLine_2: null,
			city: user.kyc?.address?.city || "Lagos",
			state: user.kyc?.address?.state || "Lagos",
			postalCode: user.kyc?.address?.postalCode || "100001",
			country: user.kyc?.address?.country || "NG",
		};

		console.log("📍 Using address from DB:", address);

		const phoneNumber = user.phoneNumber || "08000000000";
		console.log("📞 Using phone number from DB:", phoneNumber);

		const hasKYCLevel2 =
			user.kyc?.bvn && user.kyc?.dateOfBirth && user.kyc?.gender;

		console.log("🔐 Has KYC Level 2 data:", hasKYCLevel2);
		if (hasKYCLevel2) {
			console.log("   BVN:", user.kyc.bvn);
			console.log("   DOB:", user.kyc.dateOfBirth);
			console.log("   Gender:", user.kyc.gender);
		}

		// ✅ FIRST: Check if the user already has an Anchor customer by email
		console.log("🔍 Checking if email already has an Anchor customer...");

		// Try to find existing customer by creating a new one and catching the error
		let anchorResponse = null;

		if (hasKYCLevel2 && isValidBVN(user.kyc.bvn)) {
			console.log(
				"📝 Attempting to create customer with REAL KYC Level 2 (Tier 1)",
			);

			anchorResponse = await anchorService.createAnchorCustomerWithKYC({
				firstName,
				lastName,
				middleName,
				maidenName,
				email: user.email,
				phoneNumber: phoneNumber,
				address: address,
				bvn: user.kyc.bvn,
				dateOfBirth: formatDateForAnchor(user.kyc.dateOfBirth),
				gender: user.kyc.gender,
				metadata: {
					userId: user._id.toString(),
					platform: "kuditrak",
					version: "2.0",
					source: "kyc_data",
				},
			});
		} else {
			console.log("📝 Attempting to create customer as Tier 0");
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

		// ✅ If error is "Email already exists", link the existing customer
		if (
			!anchorResponse.success &&
			anchorResponse.error?.includes("Email already exist")
		) {
			console.log(
				"⚠️ Email already exists in Anchor. Linking existing customer...",
			);

			// Since we can't fetch the customer ID by email directly, we need to
			// get it from the error message or use a workaround
			return await linkExistingAnchorCustomer(user);
		}

		if (!anchorResponse.success) {
			return { success: false, error: anchorResponse.error };
		}

		// Save new Anchor customer to database
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
		console.log(
			"🔗 Attempting to link existing Anchor customer for:",
			user.email,
		);

		// Check if user already has an anchorCustomerId from a previous attempt
		if (user.anchorCustomerId) {
			console.log(
				"✅ User already has anchorCustomerId:",
				user.anchorCustomerId,
			);

			// Create local record with existing ID
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

		// If no anchorCustomerId, we need to find the existing customer ID
		// Workaround: Since we can't search by email, try to create with a temporary email
		// This might fail if the system has strict email validation
		console.log(
			"🔄 No anchorCustomerId found, attempting to find existing customer...",
		);

		// Try to get the customer ID from the Anchor system
		// One approach: Try to create a customer with a unique email, then update it
		const tempEmail = `temp_${Date.now()}_${user.email}`;
		console.log(`📧 Attempting with temporary email: ${tempEmail}`);

		// Parse full name
		const { firstName, lastName } = splitFullName(user.fullName);

		const address = {
			addressLine_1: user.kyc?.address?.street || "123 Test Street",
			city: user.kyc?.address?.city || "Lagos",
			state: user.kyc?.address?.state || "Lagos",
			postalCode: user.kyc?.address?.postalCode || "100001",
			country: user.kyc?.address?.country || "NG",
		};

		// Try to create with temporary email
		const tempResponse = await anchorService.createAnchorCustomer({
			firstName,
			lastName,
			email: tempEmail,
			phoneNumber: user.phoneNumber || `080${Date.now().toString().slice(-8)}`,
			address: address,
			metadata: {
				userId: user._id.toString(),
				platform: "kuditrak",
				isTemp: true,
			},
		});

		if (tempResponse.success) {
			console.log(
				`✅ Created temporary customer with ID: ${tempResponse.customerId}`,
			);

			// Now try to update the email to the real one
			// Note: This might fail if the email is already taken, but we can try
			const updateResponse = await anchorService.updateCustomer(
				tempResponse.customerId,
				{ email: user.email },
			);

			if (updateResponse.success) {
				console.log("✅ Updated customer with real email");
			} else {
				console.log("⚠️ Could not update email, using temporary ID");
			}

			// Save the customer
			const anchorCustomer = await AnchorCustomer.create({
				userId: user._id,
				anchorCustomerId: tempResponse.customerId,
				fullName: { firstName, lastName },
				email: user.email,
				phoneNumber: user.phoneNumber || "08000000000",
				address: address,
				kycLevel: "TIER_0",
				kycStatus: "pending",
				metadata: { userId: user._id.toString() },
			});

			user.anchorCustomerId = tempResponse.customerId;
			user.anchorCustomerStatus = "active";
			user.anchorKycLevel = "TIER_0";
			await user.save();

			return {
				success: true,
				anchorCustomer,
				customerId: tempResponse.customerId,
				isNew: true,
				wasLinked: true,
			};
		}

		// If all else fails, return error
		return {
			success: false,
			error: "Could not link existing Anchor customer. Please contact support.",
			details: "Email already exists and could not be linked automatically.",
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
