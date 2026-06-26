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
// backend/controllers/anchorWebhookController.js - Update the main handler

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

		const eventType = payload.data?.type;
		console.log(`📥 Received Anchor webhook: ${eventType}`);

		switch (eventType) {
			case "virtualNuban.opened":
				await handleVirtualNubanOpened(payload);
				break;

			case "accountNumber.created":
				await handleAccountNumberCreated(payload);
				break;
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
				console.log(`⚠️ Unhandled webhook type: ${eventType}`);
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

// backend/controllers/anchorWebhookController.js - Handle accountNumber.created

/**
 * Handle accountNumber.created webhook event
 * This is where the virtual account should be saved
 */
async function handleAccountNumberCreated(payload) {
	try {
		console.log("📥 Processing accountNumber.created webhook...");

		const included = payload.included || [];

		let accountNumberData = null;
		let depositAccountData = null;

		for (const item of included) {
			if (item.type === "AccountNumber") {
				accountNumberData = item;
				console.log(`✅ Found AccountNumber: ${item.id}`);
			}
			if (item.type === "DepositAccount") {
				depositAccountData = item;
				console.log(`✅ Found DepositAccount: ${item.id}`);
			}
		}

		if (!accountNumberData) {
			console.error("❌ No AccountNumber found in webhook");
			return;
		}

		const accNumAttrs = accountNumberData.attributes || {};
		const accountNumber = accNumAttrs.accountNumber;
		const metadata = accNumAttrs.metadata || {};
		const goalId = metadata.goalId;

		if (!goalId) {
			console.error("❌ No goalId found in metadata");
			return;
		}

		// Get bank details
		const bank = accNumAttrs.bank || {};
		const bankName = bank.name || "PROVIDUS BANK";
		const bankCode = bank.code || "000023";

		console.log(`📊 Account Number Created:`);
		console.log(`   Goal ID: ${goalId}`);
		console.log(`   Account Number: ${accountNumber}`);
		console.log(`   Bank: ${bankName} (${bankCode})`);

		// ✅ Find and update the goal
		const goal = await UserGoal.findById(goalId);
		if (!goal) {
			console.error(`❌ Goal not found: ${goalId}`);
			return;
		}

		// Update the goal with the account number
		goal.goalAccountNumber = accountNumber;
		goal.goalBankName = bankName;
		goal.goalBankCode = bankCode;
		goal.goalAccountStatus = "active";
		await goal.save();

		console.log(`✅ Goal updated with account number: ${accountNumber}`);
	} catch (error) {
		console.error("❌ Error processing accountNumber.created webhook:", error);
	}
}

// backend/controllers/anchorWebhookController.js - Add this handler

/**
 * ✅ Handle virtualNuban.opened webhook event
 * This is triggered when a new virtual account is created
 */
async function handleVirtualNubanOpened(payload) {
	try {
		console.log("📥 Processing virtualNuban.opened webhook...");

		const included = payload.included || [];

		// ✅ Find the DepositAccount in included
		let depositAccountData = null;
		let accountNumberData = null;

		for (const item of included) {
			if (item.type === "DepositAccount") {
				depositAccountData = item;
				console.log(`✅ Found DepositAccount: ${item.id}`);
			}
			if (item.type === "AccountNumber") {
				accountNumberData = item;
				console.log(`✅ Found AccountNumber: ${item.id}`);
			}
		}

		if (!depositAccountData) {
			console.error("❌ No DepositAccount found in webhook");
			return;
		}

		const depositAccountAttrs = depositAccountData.attributes || {};
		const metadata = depositAccountAttrs.metadata || {};
		const goalId = metadata.goalId;

		if (!goalId) {
			console.error("❌ No goalId found in metadata");
			return;
		}

		// ✅ Get the account number from AccountNumber data
		let accountNumber = null;
		let bankName = "PROVIDUS BANK";
		let bankCode = "000023";

		if (accountNumberData) {
			const accNumAttrs = accountNumberData.attributes || {};
			accountNumber = accNumAttrs.accountNumber;
			if (accNumAttrs.bank) {
				bankName = accNumAttrs.bank.name || bankName;
				bankCode = accNumAttrs.bank.code || bankCode;
			}
		}

		// ✅ If account number not found in AccountNumber, try the deposit account
		if (!accountNumber) {
			// The deposit account has masked number, but we can use it as fallback
			accountNumber = depositAccountAttrs.accountNumber;
		}

		const depositAccountId = depositAccountData.id;
		const accountName = depositAccountAttrs.accountName || "Kuditrak User";
		const currency = depositAccountAttrs.currency || "NGN";
		const status = depositAccountAttrs.status || "ACTIVE";
		const balance = depositAccountAttrs.availableBalance || 0;

		console.log(`📊 Webhook extracted goal account details:`);
		console.log(`   Goal ID: ${goalId}`);
		console.log(`   Account ID: ${depositAccountId}`);
		console.log(`   Account Number: ${accountNumber}`);
		console.log(`   Bank: ${bankName} (${bankCode})`);
		console.log(`   Account Name: ${accountName}`);
		console.log(`   Currency: ${currency}`);
		console.log(`   Status: ${status}`);
		console.log(`   Balance: ${balance}`);

		// ✅ Find the goal in your database
		const goal = await UserGoal.findById(goalId);
		if (!goal) {
			console.error(`❌ Goal not found: ${goalId}`);
			return;
		}

		// ✅ Check if the goal already has an account
		if (goal.goalDepositAccountId) {
			console.log(`✅ Goal already has account: ${goal.goalDepositAccountId}`);
			// Update with latest data
			if (accountNumber) {
				goal.goalAccountNumber = accountNumber;
			}
			if (bankName) {
				goal.goalBankName = bankName;
			}
			if (bankCode) {
				goal.goalBankCode = bankCode;
			}
			goal.goalAccountStatus = status.toLowerCase();
			await goal.save();
			console.log(`✅ Goal updated with latest account details`);
			return;
		}

		// ✅ Save the account details to the goal
		goal.goalDepositAccountId = depositAccountId;
		goal.goalAccountNumber = accountNumber;
		goal.goalBankName = bankName;
		goal.goalBankCode = bankCode;
		goal.goalAccountStatus = status.toLowerCase();
		goal.goalAccountBalance = balance / 100; // Convert from kobo to NGN
		await goal.save();

		console.log(`✅ Goal updated with deposit account:`);
		console.log(`   Goal: ${goal.name}`);
		console.log(`   Account: ${goal.goalAccountNumber}`);
		console.log(`   Bank: ${goal.goalBankName}`);

		// ✅ Send notification to user
		try {
			const user = await User.findById(goal.userId);
			if (user) {
				await sendPushToUser(
					user._id,
					"🏦 Goal Account Ready",
					`Your goal "${goal.name}" now has a dedicated account number: ${accountNumber}`,
					{
						type: "goal_account_created",
						goalId: goal._id,
						accountNumber: accountNumber,
						bankName: bankName,
					},
				);
			}
		} catch (pushError) {
			console.log("⚠️ Push notification error:", pushError.message);
		}
	} catch (error) {
		console.error("❌ Error processing virtualNuban.opened webhook:", error);
	}
}

/**
 * ✅ Also handle accountNumber.created webhook
 */
