// backend/services/paymentGateway.js
import axios from "axios";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
const BACKEND_URL =
	process.env.BACKEND_URL || "https://kuditrak-backend-tgr4.onrender.com";

// Configuration for charges
const CHARGES_CONFIG = {
	// Platform fee percentage for top-ups (0.5% - commented out for now)
	// PLATFORM_FEE_PERCENTAGE: 0.5,
	// Withdrawal fee (flat rate)
	WITHDRAWAL_FEE: 50,
};

// Calculate top-up charges (currently no fee)
const calculateTopUpCharges = (amount) => {
	// No fee for top-ups
	return {
		platformFee: 0,
		totalFee: 0,
		amountToCharge: amount,
	};
};

export const createTopUp = async ({ email, amount, reference, userId }) => {
	try {
		console.log("Creating Paystack transaction for:", {
			email,
			amount,
			reference,
			userId: userId?.toString(),
		});

		// Calculate charges (currently no fee for top-ups)
		const charges = calculateTopUpCharges(amount);
		const totalAmount = charges.amountToCharge;

		console.log("Top-up breakdown:", {
			amount,
			fee: charges.totalFee,
			amountToCharge: totalAmount,
		});

		const response = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email,
				amount: totalAmount * 100, // Paystack uses kobo
				reference,
				callback_url: `${BACKEND_URL}/api/wallet/verify`,
				metadata: {
					userId: userId.toString(),
					amount: amount,
					totalAmount: totalAmount,
					fee: charges.totalFee,
					platformFee: charges.platformFee,
					type: "topup",
				},
			},
			{
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
					"Content-Type": "application/json",
				},
			},
		);

		console.log("Paystack response:", response.data);

		return {
			paymentLink: response.data.data.authorization_url,
			reference: response.data.data.reference,
			amount: amount,
			totalAmount: totalAmount,
			fee: charges.totalFee,
		};
	} catch (error) {
		console.error(
			"Paystack initialize error:",
			error.response?.data || error.message,
		);
		throw new Error(
			error.response?.data?.message ||
				"Failed to initialize Paystack transaction",
		);
	}
};

// Get bank code from bank name
const getBankCode = (bankName) => {
	if (!bankName) return null;

	const bankCodes = {
		GTBank: "058",
		"Guaranty Trust Bank": "058",
		"Access Bank": "044",
		"Access Bank Plc": "044",
		"Wema Bank": "035",
		"Wema Bank Plc": "035",
		UBA: "033",
		"United Bank For Africa": "033",
		"First Bank": "011",
		"First Bank of Nigeria": "011",
		"Zenith Bank": "057",
		"Zenith Bank Plc": "057",
		FCMB: "214",
		"First City Monument Bank": "214",
		"Stanbic IBTC": "039",
		"Stanbic IBTC Bank": "039",
		"Polaris Bank": "076",
		"Polaris Bank Limited": "076",
		"Union Bank of Nigeria": "032",
		"Union Bank": "032",
		"Fidelity Bank": "070",
		"Fidelity Bank Plc": "070",
		"Sterling Bank": "232",
		"Sterling Bank Plc": "232",
		Ecobank: "050",
		"Ecobank Nigeria": "050",
	};

	if (bankCodes[bankName]) return bankCodes[bankName];

	for (const [key, code] of Object.entries(bankCodes)) {
		if (
			bankName.toLowerCase().includes(key.toLowerCase()) ||
			key.toLowerCase().includes(bankName.toLowerCase())
		) {
			return code;
		}
	}

	return null;
};

// Get or create recipient code for a bank account
export const getOrCreateRecipient = async (bankAccount) => {
	try {
		// If recipient code already exists, return it
		if (bankAccount.recipientCode) {
			console.log("Using existing recipient code:", bankAccount.recipientCode);
			return { success: true, recipientCode: bankAccount.recipientCode };
		}

		console.log("Creating new recipient for:", {
			bankName: bankAccount.bankName,
			accountNumber: bankAccount.accountNumber,
			accountName: bankAccount.accountName,
			bankCode: bankAccount.bankCode,
		});

		// Get bank code
		let bankCode = bankAccount.bankCode;
		if (!bankCode || bankCode === "000000") {
			bankCode = getBankCode(bankAccount.bankName);
			if (!bankCode) {
				return {
					success: false,
					message: `Bank code not found for ${bankAccount.bankName}. Please contact support.`,
				};
			}
		}

		// Create recipient in Paystack
		const response = await axios.post(
			"https://api.paystack.co/transferrecipient",
			{
				type: "nuban",
				name: bankAccount.accountName,
				account_number: bankAccount.accountNumber,
				bank_code: bankCode,
				currency: "NGN",
			},
			{
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
					"Content-Type": "application/json",
				},
			},
		);

		if (response.data.status) {
			const recipientCode = response.data.data.recipient_code;
			console.log("Recipient created successfully:", recipientCode);

			// Save recipient code to bank account
			bankAccount.recipientCode = recipientCode;
			bankAccount.recipientCreatedAt = new Date();
			await bankAccount.save();

			return { success: true, recipientCode };
		} else {
			console.error("Failed to create recipient:", response.data);
			return {
				success: false,
				message: response.data.message || "Failed to create transfer recipient",
			};
		}
	} catch (error) {
		console.error(
			"Create recipient error:",
			error.response?.data || error.message,
		);
		return {
			success: false,
			message: error.response?.data?.message || "Failed to create recipient",
		};
	}
};

export const initiatePayout = async ({
	amount, // This should be the amount user wants to receive
	userId,
	bankAccountId,
	recipientCode,
	reference,
}) => {
	try {
		console.log("Initiating payout:", {
			amount,
			userId,
			bankAccountId,
			recipientCode,
			reference,
		});

		if (!recipientCode) {
			return {
				success: false,
				message: "Recipient code is required",
			};
		}

		const koboAmount = Number(amount) * 100; // Send exactly the amount passed

		const response = await axios.post(
			"https://api.paystack.co/transfer",
			{
				source: "balance",
				reason: `Wallet withdrawal - ${reference}`,
				amount: koboAmount,
				recipient: recipientCode,
				reference: reference,
				currency: "NGN",
			},
			{
				headers: {
					Authorization: `Bearer ${PAYSTACK_SECRET}`,
					"Content-Type": "application/json",
				},
			},
		);

		console.log("Transfer response:", response.data);

		if (response.data.status) {
			return {
				success: true,
				message: "Transfer initiated successfully",
				transferCode: response.data.data.transfer_code,
				transferReference: response.data.data.reference,
				amount: Number(amount),
				fee: 0, // No fee deducted here - fee is handled in wallet controller
				data: response.data.data,
			};
		} else {
			return {
				success: false,
				message: response.data.message || "Transfer failed",
			};
		}
	} catch (err) {
		console.error("Payout error:", err.response?.data || err.message);
		return {
			success: false,
			message: err.response?.data?.message || err.message || "Payout failed",
		};
	}
};
