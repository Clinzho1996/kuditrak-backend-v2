// backend/services/anchorWebhookService.js
import AnchorCard from "../models/AnchorCard.js";
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import anchorService from "./anchorService.js";
import { sendPushToUser } from "./pushService.js";

/**
 * Process KYC approval webhook
 */
export const processKYCApproved = async (payload) => {
	try {
		const customerId = payload.relationships?.customer?.data?.id;
		if (!customerId) {
			console.error("No customer ID in KYC approved webhook");
			return { success: false, error: "No customer ID" };
		}

		const anchorCustomer = await AnchorCustomer.findOne({
			anchorCustomerId: customerId,
		});
		if (!anchorCustomer) {
			console.error(`Anchor customer not found: ${customerId}`);
			return { success: false, error: "Customer not found" };
		}

		// Update customer KYC status
		anchorCustomer.kycStatus = "approved";
		anchorCustomer.kycLevel = "TIER_1";
		await anchorCustomer.save();

		// Update user
		const user = await User.findById(anchorCustomer.userId);
		if (user) {
			user.anchorCustomerStatus = "active";
			user.anchorKycLevel = "TIER_1";
			user.kyc.isVerified = true;
			user.kyc.verifiedAt = new Date();
			user.kyc.paystackValidationPending = false;
			await user.save();

			// Send push notification
			await sendPushToUser(
				user._id,
				"✅ KYC Approved!",
				"Your identity has been verified. You can now create virtual cards and access all features.",
				{ type: "kyc_approved", level: "TIER_1" },
			);
		}

		console.log(`✅ KYC approved for customer: ${customerId}`);
		return { success: true, customerId };
	} catch (error) {
		console.error("Process KYC approved error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process KYC rejection webhook
 */
export const processKYCRejected = async (payload) => {
	try {
		const customerId = payload.relationships?.customer?.data?.id;
		if (!customerId) {
			console.error("No customer ID in KYC rejected webhook");
			return { success: false, error: "No customer ID" };
		}

		const anchorCustomer = await AnchorCustomer.findOne({
			anchorCustomerId: customerId,
		});
		if (!anchorCustomer) {
			console.error(`Anchor customer not found: ${customerId}`);
			return { success: false, error: "Customer not found" };
		}

		anchorCustomer.kycStatus = "rejected";
		await anchorCustomer.save();

		// Update user
		const user = await User.findById(anchorCustomer.userId);
		if (user) {
			user.kyc.paystackValidationPending = false;
			user.kyc.validationError =
				"KYC verification failed. Please check your information.";
			await user.save();

			// Send push notification
			await sendPushToUser(
				user._id,
				"❌ KYC Verification Failed",
				"Your KYC verification was not approved. Please check your information and try again.",
				{ type: "kyc_rejected" },
			);
		}

		console.log(`❌ KYC rejected for customer: ${customerId}`);
		return { success: true, customerId };
	} catch (error) {
		console.error("Process KYC rejected error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process KYC error webhook
 */
export const processKYCError = async (payload) => {
	try {
		const customerId = payload.relationships?.customer?.data?.id;
		if (!customerId) {
			console.error("No customer ID in KYC error webhook");
			return { success: false, error: "No customer ID" };
		}

		const anchorCustomer = await AnchorCustomer.findOne({
			anchorCustomerId: customerId,
		});
		if (!anchorCustomer) {
			console.error(`Anchor customer not found: ${customerId}`);
			return { success: false, error: "Customer not found" };
		}

		anchorCustomer.kycStatus = "error";
		await anchorCustomer.save();

		const user = await User.findById(anchorCustomer.userId);
		if (user) {
			await sendPushToUser(
				user._id,
				"⚠️ KYC Verification Error",
				"There was an error processing your KYC. Please try again or contact support.",
				{ type: "kyc_error" },
			);
		}

		console.log(`⚠️ KYC error for customer: ${customerId}`);
		return { success: true, customerId };
	} catch (error) {
		console.error("Process KYC error error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process transaction webhook (credit/debit)
 */
export const processTransaction = async (payload) => {
	try {
		const transaction = payload.data?.attributes;
		if (!transaction) {
			console.error("No transaction data in webhook");
			return { success: false, error: "No transaction data" };
		}

		const { walletId, amount, reference, status, type, narration, metadata } =
			transaction;

		// Find wallet
		const anchorWallet = await AnchorWallet.findOne({ walletId });
		if (!anchorWallet) {
			console.error(`Wallet not found: ${walletId}`);
			return { success: false, error: "Wallet not found" };
		}

		// Check if transaction already exists
		const existingTransaction = await AnchorTransaction.findOne({
			anchorReference: reference,
		});
		if (existingTransaction) {
			console.log(`Transaction already processed: ${reference}`);
			return { success: true, alreadyProcessed: true };
		}

		// Create transaction record
		const newTransaction = await AnchorTransaction.create({
			userId: anchorWallet.userId,
			anchorCustomerId: anchorWallet.anchorCustomerId,
			walletId: anchorWallet._id,
			anchorTransactionId: payload.data?.id,
			anchorReference: reference,
			amount: amount / 100, // Convert from kobo
			currency: "NGN",
			type: type === "credit" ? "credit" : "debit",
			category: type === "credit" ? "deposit" : "withdrawal",
			status:
				status === "success"
					? "success"
					: status === "pending"
						? "pending"
						: "failed",
			description: narration || `${type} transaction`,
			fees: {
				anchorFee: metadata?.fees?.anchorFee || 0,
				processingFee: metadata?.fees?.processingFee || 0,
				totalFee:
					(metadata?.fees?.anchorFee || 0) +
					(metadata?.fees?.processingFee || 0),
			},
			settlementDate: status === "success" ? new Date() : null,
			metadata: metadata || {},
			createdAt: new Date(),
		});

		// Update wallet balance if successful
		if (status === "success") {
			const balanceResponse = await anchorService.getWalletBalance(walletId);
			if (balanceResponse.success) {
				anchorWallet.balance = balanceResponse.balance;
				await anchorWallet.save();
			}
		}

		// Send notification to user
		const user = await User.findById(anchorWallet.userId);
		if (user && status === "success") {
			const formattedAmount = `₦${(amount / 100).toLocaleString()}`;
			await sendPushToUser(
				user._id,
				type === "credit" ? "💰 Money Received" : "💸 Payment Made",
				type === "credit"
					? `${formattedAmount} received into your wallet`
					: `${formattedAmount} debited from your wallet`,
				{
					type: "transaction",
					reference,
					amount: amount / 100,
					transactionType: type,
				},
			);
		}

		console.log(`✅ Transaction processed: ${reference} (${type})`);
		return { success: true, transaction: newTransaction };
	} catch (error) {
		console.error("Process transaction error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process virtual account credit webhook
 */
export const processVirtualAccountCredit = async (payload) => {
	try {
		const attributes = payload.data?.attributes;
		if (!attributes) {
			console.error("No virtual account credit data");
			return { success: false, error: "No data" };
		}

		const {
			accountNumber,
			amount,
			reference,
			senderName,
			senderAccountNumber,
			narration,
		} = attributes;

		// Find virtual account
		const virtualAccount = await AnchorVirtualAccount.findOne({
			accountNumber,
		});
		if (!virtualAccount) {
			console.error(`Virtual account not found: ${accountNumber}`);
			return { success: false, error: "Virtual account not found" };
		}

		// Find wallet
		const wallet = await AnchorWallet.findById(virtualAccount.walletId);
		if (!wallet) {
			console.error(`Wallet not found for virtual account: ${accountNumber}`);
			return { success: false, error: "Wallet not found" };
		}

		// Check if transaction already exists
		const existingTransaction = await AnchorTransaction.findOne({
			anchorReference: reference,
		});
		if (existingTransaction) {
			console.log(`Transaction already processed: ${reference}`);
			return { success: true, alreadyProcessed: true };
		}

		// Create transaction record
		const newTransaction = await AnchorTransaction.create({
			userId: virtualAccount.userId,
			anchorCustomerId: virtualAccount.anchorCustomerId,
			walletId: wallet._id,
			virtualAccountId: virtualAccount._id,
			anchorReference: reference,
			amount: amount / 100,
			currency: "NGN",
			type: "credit",
			category: "deposit",
			status: "success",
			description:
				narration ||
				`Transfer from ${senderName || "external account"} via virtual account`,
			source: "bank_transfer",
			destination: "wallet",
			metadata: {
				accountNumber,
				senderName,
				senderAccountNumber,
			},
			createdAt: new Date(),
		});

		// Update wallet balance
		const balanceResponse = await anchorService.getWalletBalance(
			wallet.walletId,
		);
		if (balanceResponse.success) {
			wallet.balance = balanceResponse.balance;
			await wallet.save();
		}

		// Send notification
		const user = await User.findById(virtualAccount.userId);
		if (user) {
			await sendPushToUser(
				user._id,
				"💰 Deposit Received",
				`₦${(amount / 100).toLocaleString()} has been deposited to your account`,
				{
					type: "deposit",
					amount: amount / 100,
					reference,
					sender: senderName || "External Account",
				},
			);
		}

		console.log(`✅ Virtual account credit processed: ${reference}`);
		return { success: true, transaction: newTransaction };
	} catch (error) {
		console.error("Process virtual account credit error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process card payment webhook
 */
export const processCardPayment = async (payload) => {
	try {
		const attributes = payload.data?.attributes;
		if (!attributes) {
			console.error("No card payment data");
			return { success: false, error: "No data" };
		}

		const {
			cardId,
			amount,
			merchantName,
			merchantCode,
			reference,
			status,
			narration,
		} = attributes;

		// Find card
		const card = await AnchorCard.findOne({ cardId });
		if (!card) {
			console.error(`Card not found: ${cardId}`);
			return { success: false, error: "Card not found" };
		}

		// Find wallet
		const wallet = await AnchorWallet.findById(card.walletId);
		if (!wallet) {
			console.error(`Wallet not found for card: ${cardId}`);
			return { success: false, error: "Wallet not found" };
		}

		// Check if transaction already exists
		const existingTransaction = await AnchorTransaction.findOne({
			anchorReference: reference,
		});
		if (existingTransaction) {
			console.log(`Transaction already processed: ${reference}`);
			return { success: true, alreadyProcessed: true };
		}

		// Create transaction record
		const newTransaction = await AnchorTransaction.create({
			userId: card.userId,
			anchorCustomerId: card.anchorCustomerId,
			walletId: wallet._id,
			cardId: card._id,
			anchorReference: reference,
			amount: amount / 100,
			currency: "NGN",
			type: "debit",
			category: "card_purchase",
			status:
				status === "success"
					? "success"
					: status === "pending"
						? "pending"
						: "failed",
			description: narration || `Payment to ${merchantName || "merchant"}`,
			source: "card",
			destination: "external_bank",
			metadata: {
				merchantName,
				merchantCode,
				cardLast4: card.last4,
			},
			createdAt: new Date(),
		});

		// Update wallet balance if successful
		if (status === "success") {
			const balanceResponse = await anchorService.getWalletBalance(
				wallet.walletId,
			);
			if (balanceResponse.success) {
				wallet.balance = balanceResponse.balance;
				await wallet.save();
			}
		}

		// Send notification
		const user = await User.findById(card.userId);
		if (user && status === "success") {
			await sendPushToUser(
				user._id,
				"💳 Card Payment",
				`₦${(amount / 100).toLocaleString()} paid to ${merchantName || "merchant"} using card ending in ${card.last4}`,
				{
					type: "card_payment",
					amount: amount / 100,
					merchantName,
					cardLast4: card.last4,
					reference,
				},
			);
		}

		console.log(`✅ Card payment processed: ${reference}`);
		return { success: true, transaction: newTransaction };
	} catch (error) {
		console.error("Process card payment error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process card authorization webhook
 */
export const processCardAuthorization = async (payload) => {
	try {
		const attributes = payload.data?.attributes;
		if (!attributes) {
			console.error("No card authorization data");
			return { success: false, error: "No data" };
		}

		const {
			cardId,
			amount,
			merchantName,
			reference,
			status,
			authorizationCode,
		} = attributes;

		// Find card
		const card = await AnchorCard.findOne({ cardId });
		if (!card) {
			console.error(`Card not found: ${cardId}`);
			return { success: false, error: "Card not found" };
		}

		const user = await User.findById(card.userId);
		if (user && status === "pending") {
			await sendPushToUser(
				user._id,
				"🔐 Card Authorization Required",
				`${merchantName || "Merchant"} is authorizing ₦${(amount / 100).toLocaleString()} on your card`,
				{
					type: "card_authorization",
					amount: amount / 100,
					merchantName,
					authorizationCode,
					reference,
				},
			);
		}

		console.log(`Card authorization processed: ${reference}`);
		return { success: true };
	} catch (error) {
		console.error("Process card authorization error:", error);
		return { success: false, error: error.message };
	}
};

export default {
	processKYCApproved,
	processKYCRejected,
	processKYCError,
	processTransaction,
	processVirtualAccountCredit,
	processCardPayment,
	processCardAuthorization,
};
