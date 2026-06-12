// backend/controllers/anchorWebhookController.js
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Handle Anchor webhook events
 */
export const handleAnchorWebhook = async (req, res) => {
	try {
		const signature = req.headers["x-anchor-signature"];
		const timestamp = req.headers["x-anchor-timestamp"];
		const payload = req.body;

		// Verify webhook signature
		const isValid = anchorService.verifyWebhookSignature(
			payload,
			signature,
			timestamp,
		);
		if (!isValid) {
			console.error("Invalid webhook signature");
			return res.status(401).json({ error: "Invalid signature" });
		}

		const eventType = payload.type;
		console.log(`Received Anchor webhook: ${eventType}`);

		switch (eventType) {
			case "customer.identification.approved":
				await handleCustomerIdentificationApproved(payload);
				break;
			case "customer.identification.rejected":
				await handleCustomerIdentificationRejected(payload);
				break;
			case "customer.identification.error":
				await handleCustomerIdentificationError(payload);
				break;
			case "transaction.credit":
			case "transaction.debit":
				await handleTransactionEvent(payload);
				break;
			case "virtual_account.credit":
				await handleVirtualAccountCredit(payload);
				break;
			case "card.authorization":
			case "card.payment":
				await handleCardPaymentEvent(payload);
				break;
			default:
				console.log(`Unhandled webhook type: ${eventType}`);
		}

		res.status(200).json({ success: true });
	} catch (error) {
		console.error("Webhook handling error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Handle KYC approval
 */
async function handleCustomerIdentificationApproved(payload) {
	const customerId = payload.relationships?.customer?.data?.id;
	if (!customerId) return;

	const anchorCustomer = await AnchorCustomer.findOne({
		anchorCustomerId: customerId,
	});
	if (!anchorCustomer) return;

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
		await user.save();

		// Send notification
		await sendPushToUser(
			user._id,
			"✅ KYC Approved!",
			"Your identity has been verified. You can now create virtual cards and access all features.",
			{ type: "kyc_approved" },
		);
	}
}

/**
 * Handle KYC rejection
 */
async function handleCustomerIdentificationRejected(payload) {
	const customerId = payload.relationships?.customer?.data?.id;
	if (!customerId) return;

	const anchorCustomer = await AnchorCustomer.findOne({
		anchorCustomerId: customerId,
	});
	if (!anchorCustomer) return;

	anchorCustomer.kycStatus = "rejected";
	await anchorCustomer.save();

	const user = await User.findById(anchorCustomer.userId);
	if (user) {
		await sendPushToUser(
			user._id,
			"❌ KYC Verification Failed",
			"Your KYC verification was not approved. Please check your information and try again.",
			{ type: "kyc_rejected" },
		);
	}
}

/**
 * Handle KYC error
 */
async function handleCustomerIdentificationError(payload) {
	const customerId = payload.relationships?.customer?.data?.id;
	if (!customerId) return;

	const anchorCustomer = await AnchorCustomer.findOne({
		anchorCustomerId: customerId,
	});
	if (!anchorCustomer) return;

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
}

/**
 * Handle transaction events
 */
async function handleTransactionEvent(payload) {
	const transaction = payload.data?.attributes;
	if (!transaction) return;

	const { walletId, amount, reference, status, type, narration } = transaction;

	// Find wallet
	const anchorWallet = await AnchorWallet.findOne({ walletId });
	if (!anchorWallet) return;

	// Create transaction record
	await AnchorTransaction.create({
		userId: anchorWallet.userId,
		anchorCustomerId: anchorWallet.anchorCustomerId,
		walletId: anchorWallet._id,
		anchorTransactionId: payload.data?.id,
		anchorReference: reference,
		amount: amount / 100, // Convert from kobo
		currency: "NGN",
		type: type === "credit" ? "credit" : "debit",
		category: type === "credit" ? "deposit" : "withdrawal",
		status: status === "success" ? "success" : "failed",
		description: narration || `${type} transaction`,
		createdAt: new Date(),
	});

	// Update wallet balance if needed
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
		await sendPushToUser(
			user._id,
			type === "credit" ? "💰 Money Received" : "💸 Payment Made",
			type === "credit"
				? `₦${(amount / 100).toLocaleString()} received into your wallet`
				: `₦${(amount / 100).toLocaleString()} debited from your wallet`,
			{ type: "transaction", reference, amount: amount / 100 },
		);
	}
}

/**
 * Handle virtual account credit
 */
async function handleVirtualAccountCredit(payload) {
	const attributes = payload.data?.attributes;
	if (!attributes) return;

	const { accountNumber, amount, reference, senderName } = attributes;

	// Find virtual account
	const virtualAccount = await AnchorVirtualAccount.findOne({ accountNumber });
	if (!virtualAccount) return;

	// Find wallet
	const wallet = await AnchorWallet.findById(virtualAccount.walletId);
	if (!wallet) return;

	// Create transaction record
	await AnchorTransaction.create({
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
		description: `Transfer from ${senderName || "external account"} via virtual account`,
		source: "bank_transfer",
		destination: "wallet",
		metadata: { accountNumber, senderName },
		createdAt: new Date(),
	});

	// Update wallet balance
	const balanceResponse = await anchorService.getWalletBalance(wallet.walletId);
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
			{ type: "deposit", amount: amount / 100, reference },
		);
	}
}

/**
 * Handle card payment events
 */
async function handleCardPaymentEvent(payload) {
	const attributes = payload.data?.attributes;
	if (!attributes) return;

	const { cardId, amount, merchantName, reference, status } = attributes;

	// Find card
	const card = await AnchorCard.findOne({ cardId });
	if (!card) return;

	// Find wallet
	const wallet = await AnchorWallet.findById(card.walletId);
	if (!wallet) return;

	// Create transaction record
	await AnchorTransaction.create({
		userId: card.userId,
		anchorCustomerId: card.anchorCustomerId,
		walletId: wallet._id,
		cardId: card._id,
		anchorReference: reference,
		amount: amount / 100,
		currency: "NGN",
		type: "debit",
		category: "card_purchase",
		status: status === "success" ? "success" : "failed",
		description: `Payment to ${merchantName || "merchant"}`,
		source: "card",
		destination: "external_bank",
		metadata: { merchantName, cardLast4: card.last4 },
		createdAt: new Date(),
	});

	// Update wallet balance if needed
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
			},
		);
	}
}
