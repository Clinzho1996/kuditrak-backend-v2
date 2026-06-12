// services/dvaService.js
import axios from "axios";
import User from "../models/User.js";
import userVirtualAccount from "../models/userVirtualAccount.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

// Verify BVN via Customer Identification
// services/dvaService.js - Updated verifyBVN

export const verifyBVN = async (bvn, user, bankAccount) => {
	try {
		console.log(`🔵 Verifying BVN for user: ${user._id}`);

		// Check if already pending
		if (user.kyc?.paystackValidationPending) {
			console.log("⚠️ Validation already pending");
			return {
				success: true,
				pending: true,
				message: "BVN verification already in progress",
			};
		}

		console.log(`📝 BVN: ${bvn}`);
		console.log(`👤 User name: ${user.fullName}`);
		console.log(
			`🏦 Bank Account: ${bankAccount?.accountNumber} (${bankAccount?.bankCode})`,
		);

		// Validate bank account details
		if (!bankAccount?.accountNumber || !bankAccount?.bankCode) {
			console.log("❌ Missing bank account details");
			return {
				success: false,
				message:
					"Bank account details are required for BVN verification. Please connect a bank account.",
			};
		}

		// Step 1: Get or create customer
		let customerCode;

		try {
			const searchResponse = await axios.get(`${PAYSTACK_BASE_URL}/customer`, {
				params: { email: user.email },
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
				},
			});

			if (searchResponse.data.data && searchResponse.data.data.length > 0) {
				customerCode = searchResponse.data.data[0].customer_code;
				console.log(`✅ Found existing customer: ${customerCode}`);
			}
		} catch (error) {
			console.log("Customer not found, will create new one");
		}

		// Create customer if not exists
		if (!customerCode) {
			const createResponse = await axios.post(
				`${PAYSTACK_BASE_URL}/customer`,
				{
					email: user.email,
					first_name: user.fullName?.split(" ")[0] || "User",
					last_name: user.fullName?.split(" ")[1] || "Account",
					phone: user.phoneNumber || "08000000000",
				},
				{
					headers: {
						Authorization: `Bearer ${PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			if (createResponse.data.status) {
				customerCode = createResponse.data.data.customer_code;
				console.log(`✅ Created new customer: ${customerCode}`);
			} else {
				throw new Error("Failed to create customer");
			}
		}

		// Save customer code
		if (!user.kyc?.paystackCustomerCode) {
			user.kyc.paystackCustomerCode = customerCode;
			await user.save();
		}

		// Step 2: Prepare validation payload with REAL bank account details
		const validationPayload = {
			country: "NG",
			type: "bank_account",
			account_number: bankAccount.accountNumber, // Use real account number
			bvn: bvn,
			bank_code: bankAccount.bankCode, // Use real bank code
			first_name: user.fullName?.split(" ")[0] || "",
			last_name: user.fullName?.split(" ")[1] || "",
		};

		console.log("📤 Validation payload with REAL bank details:");
		console.log("   Account Number:", validationPayload.account_number);
		console.log("   Bank Code:", validationPayload.bank_code);
		console.log("   BVN:", validationPayload.bvn);
		console.log(
			"   Name:",
			validationPayload.first_name,
			validationPayload.last_name,
		);

		// Step 3: Initiate validation
		const validationResponse = await axios.post(
			`${PAYSTACK_BASE_URL}/customer/${customerCode}/identification`,
			validationPayload,
			{
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
					"Content-Type": "application/json",
				},
			},
		);

		console.log("📥 Validation response:", validationResponse.data);

		console.log("📥 Validation response:", validationResponse.data);

		// Handle "already validated" case
		if (
			!validationResponse.data.status &&
			validationResponse.data.message ===
				"Customer already validated using the same credentials"
		) {
			console.log("✅ Customer already validated - treating as success");

			// Mark as verified immediately since they're already validated
			user.kyc.paystackValidationPending = false;
			user.kyc.paystackValidated = true;
			user.kyc.isVerified = true;
			user.kyc.bvnVerified = true;
			user.kyc.bvn = bvn;
			user.kyc.verifiedAt = new Date();
			await user.save();

			return {
				success: true,
				verified: true,
				alreadyValidated: true,
				customerCode: customerCode,
				message: "Customer already verified successfully",
			};
		}

		if (validationResponse.data.status) {
			// Mark validation as pending
			user.kyc.paystackValidationPending = true;
			user.kyc.bvn = bvn;
			await user.save();

			return {
				success: true,
				pending: true,
				customerCode: customerCode,
				message: "BVN verification initiated with your bank account.",
			};
		} else {
			return {
				success: false,
				message: validationResponse.data.message || "BVN verification failed",
			};
		}
	} catch (error) {
		console.error("❌ BVN verification error:");
		console.error("Data:", JSON.stringify(error.response?.data, null, 2));

		const errorMessage = error.response?.data?.message;
		const errorData = error.response?.data;

		if (errorMessage === "Pending request already exists") {
			user.kyc.paystackValidationPending = true;
			await user.save();
			return {
				success: true,
				pending: true,
				message: "BVN verification already in progress",
			};
		}

		// Handle "already validated" case from error response
		if (
			errorMessage === "Customer already validated using the same credentials"
		) {
			console.log(
				"✅ Customer already validated (from error) - treating as success",
			);

			// Mark as verified immediately
			user.kyc.paystackValidationPending = false;
			user.kyc.paystackValidated = true;
			user.kyc.isVerified = true;
			user.kyc.bvnVerified = true;
			user.kyc.bvn = bvn;
			user.kyc.verifiedAt = new Date();
			await user.save();

			return {
				success: true,
				verified: true,
				alreadyValidated: true,
				customerCode: user.kyc?.paystackCustomerCode,
				message: "Customer already verified successfully",
			};
		}

		return {
			success: false,
			message:
				errorMessage ||
				"BVN verification failed. Please check your BVN and bank account.",
		};
	}
};

// Create virtual account after validation is complete
export const createVirtualAccount = async (user) => {
	try {
		const customerCode = user.kyc?.paystackCustomerCode;
		if (!customerCode) {
			return {
				success: false,
				error: "No customer found. Please complete KYC first.",
			};
		}

		console.log(`Creating virtual account for customer: ${customerCode}`);

		// Get available banks
		const banksResponse = await axios.get(
			`${PAYSTACK_BASE_URL}/dedicated_account/available_providers`,
			{
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
				},
			},
		);

		const availableBanks = banksResponse.data.data || [];
		let preferredBank = "wema-bank";
		if (availableBanks.length > 0) {
			preferredBank = availableBanks[0].provider_slug;
		}

		console.log(`Using bank: ${preferredBank}`);

		// Create dedicated virtual account
		const dvaResponse = await axios.post(
			`${PAYSTACK_BASE_URL}/dedicated_account`,
			{
				customer: customerCode,
				preferred_bank: preferredBank,
			},
			{
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
					"Content-Type": "application/json",
				},
				timeout: 15000,
			},
		);

		if (dvaResponse.data.status) {
			const data = dvaResponse.data.data;

			const virtualAccount = await userVirtualAccount.create({
				userId: user._id,
				accountNumber: data.account_number,
				bankName: data.bank.name,
				accountName: data.account_name,
				provider: data.bank.slug,
				customerCode: customerCode,
				isActive: true,
			});

			console.log(`✅ Virtual account created: ${data.account_number}`);

			return {
				success: true,
				accountNumber: data.account_number,
				bankName: data.bank.name,
				accountName: data.account_name,
				provider: data.bank.slug,
				virtualAccount,
			};
		}

		throw new Error("Failed to create virtual account");
	} catch (error) {
		console.error(
			"Create virtual account error:",
			error.response?.data || error.message,
		);
		return {
			success: false,
			error: "Virtual account service unavailable. Please use card payment.",
		};
	}
};

// Webhook handler for customer identification events
export const handleCustomerIdentificationWebhook = async (event, data) => {
	try {
		console.log(`📨 Processing webhook: ${event}`);
		console.log("Webhook data:", JSON.stringify(data, null, 2));

		if (event === "customeridentification.success") {
			const { customer_code, identification } = data;

			// Find user by customer_code
			const user = await User.findOne({
				"kyc.paystackCustomerCode": customer_code,
			});

			if (user) {
				console.log(`✅ User found: ${user._id}`);

				// Update user's KYC status
				user.kyc.paystackValidated = true;
				user.kyc.paystackValidationPending = false;
				user.kyc.isVerified = true;
				user.kyc.verifiedAt = new Date();
				user.kyc.bvnVerified = true;

				// Update name from BVN if needed
				if (identification?.first_name && identification?.last_name) {
					const fullName = `${identification.first_name} ${identification.last_name}`;
					if (fullName !== user.fullName) {
						user.fullName = fullName;
					}
				}

				await user.save();

				// Create virtual account now that validation is complete
				await createVirtualAccount(user);

				console.log(
					`✅ Customer ${customer_code} validated successfully for user ${user._id}`,
				);

				// Send push notification
				try {
					await sendPushToUser(
						user._id,
						"✅ KYC Verified!",
						"Your KYC has been verified. You can now fund your wallet via bank transfer!",
						{ type: "kyc_complete", screen: "topup" },
					);
				} catch (notifError) {
					console.error("Failed to send notification:", notifError);
				}
			}
		} else if (event === "customeridentification.failed") {
			const { customer_code, reason } = data;

			const user = await User.findOne({
				"kyc.paystackCustomerCode": customer_code,
			});

			if (user) {
				user.kyc.paystackValidationPending = false;
				user.kyc.validationError = reason;
				await user.save();

				console.log(`❌ Customer validation failed for ${user._id}: ${reason}`);
			}
		}
	} catch (error) {
		console.error("Webhook handling error:", error);
	}
};
// ================= KYC CHECK =================

// Check if user has completed KYC
// services/dvaService.js - Update hasCompletedKYC

export const hasCompletedKYC = async (userId) => {
	const user = await User.findById(userId);
	if (!user) return false;

	return !!(
		user.kyc?.isVerified &&
		user.kyc.bvn &&
		user.kyc.bvnVerified &&
		user.kyc.dateOfBirth &&
		user.kyc.address?.street &&
		user.kyc.address?.city &&
		user.kyc.address?.state &&
		user.kyc.identification?.type &&
		user.kyc.identification?.number
	);
};

// ================= CUSTOMER VALIDATION =================

// Validate customer with Paystack (BVN + Bank Account)
export const validateCustomer = async (customerCode, user) => {
	try {
		console.log(`Validating customer: ${customerCode} for user: ${user._id}`);

		// Get the user's bank account (you need to have a bank account connected)
		const bankAccount = user.bankAccounts && user.bankAccounts[0];

		if (!bankAccount && process.env.NODE_ENV !== "production") {
			// Use test credentials for development
			console.log("Using test credentials for BVN validation");
			const validationResponse = await axios.post(
				`${PAYSTACK_BASE_URL}/customer/${customerCode}/identification`,
				{
					country: "NG",
					type: "bank_account",
					account_number: "0111111111", // Test account number
					bvn: "222222222221", // Test BVN
					bank_code: "007", // Test bank code (Fidelity Bank)
					first_name: user.fullName?.split(" ")[0] || "Test",
					last_name: user.fullName?.split(" ")[1] || "User",
				},
				{
					headers: {
						Authorization: `Bearer ${PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			console.log("Customer validation initiated:", validationResponse.data);

			return {
				success: true,
				pending: true,
				message: "Customer validation initiated. Waiting for verification...",
			};
		}

		// Production: Use actual user bank account
		if (bankAccount && bankAccount.accountNumber && bankAccount.bankCode) {
			const validationResponse = await axios.post(
				`${PAYSTACK_BASE_URL}/customer/${customerCode}/identification`,
				{
					country: "NG",
					type: "bank_account",
					account_number: bankAccount.accountNumber,
					bvn: user.kyc?.bvn,
					bank_code: bankAccount.bankCode,
					first_name: user.fullName?.split(" ")[0] || "",
					last_name: user.fullName?.split(" ")[1] || "",
				},
				{
					headers: {
						Authorization: `Bearer ${PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			console.log("Customer validation initiated:", validationResponse.data);

			return {
				success: true,
				pending: true,
				message: "Customer validation initiated. Waiting for verification...",
			};
		}

		return {
			success: false,
			message:
				"No bank account found for validation. Please link a bank account.",
		};
	} catch (error) {
		console.error(
			"Customer validation error:",
			error.response?.data || error.message,
		);
		return {
			success: false,
			message: error.response?.data?.message || "Customer validation failed",
		};
	}
};

// services/dvaService.js - Simplified createVirtualAccount
// ================= VIRTUAL ACCOUNT MANAGEMENT =================

// Get or create virtual account for user
export const getOrCreateVirtualAccount = async (user) => {
	try {
		// Check KYC first
		const hasKYC = await hasCompletedKYC(user._id);
		if (!hasKYC) {
			return {
				success: false,
				requiresKYC: true,
				error:
					"KYC verification required to use bank transfer funding. Please complete your profile verification.",
			};
		}

		let virtualAccount = await getUserVirtualAccount(user._id);

		if (!virtualAccount) {
			virtualAccount = await createVirtualAccount(user);
		}

		return virtualAccount;
	} catch (error) {
		console.error("Get or create virtual account error:", error.message);
		return {
			success: false,
			requiresKYC: false,
			error: error.message,
		};
	}
};

// Get user's virtual account
export const getUserVirtualAccount = async (userId) => {
	try {
		const virtualAccount = await userVirtualAccount.findOne({
			userId,
			isActive: true,
		});
		return virtualAccount;
	} catch (error) {
		console.error("Get virtual account error:", error);
		return null;
	}
};

// Deactivate virtual account
export const deactivateVirtualAccount = async (userId) => {
	try {
		await userVirtualAccount.updateOne(
			{ userId, isActive: true },
			{ isActive: false, updatedAt: new Date() },
		);
		console.log(`Virtual account deactivated for user ${userId}`);
		return { success: true };
	} catch (error) {
		console.error("Deactivate virtual account error:", error);
		return { success: false };
	}
};

// Check if user has an active virtual account
export const hasActiveVirtualAccount = async (userId) => {
	try {
		const account = await userVirtualAccount.findOne({
			userId,
			isActive: true,
		});
		return !!account;
	} catch (error) {
		console.error("Check virtual account error:", error);
		return false;
	}
};
