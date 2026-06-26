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

		// ✅ Extract account number data from included
		let accountNumberData = null;
		let depositAccountData = null;

		for (const item of included) {
			if (item.type === "AccountNumber") {
				accountNumberData = item;
				console.log(`✅ Found AccountNumber in included: ${item.id}`);
			}
			if (item.type === "DepositAccount") {
				depositAccountData = item;
				console.log(`✅ Found DepositAccount in included: ${item.id}`);
			}
		}

		if (!accountNumberData || !depositAccountData) {
			console.error("❌ Missing AccountNumber or DepositAccount in webhook");
			return;
		}

		const accountNumberAttrs = accountNumberData.attributes || {};
		const depositAccountAttrs = depositAccountData.attributes || {};

		// ✅ Extract ALL bank details from the webhook
		const bank = accountNumberAttrs.bank || {};
		const accountNumber = accountNumberAttrs.accountNumber;
		const bankName = bank.name;
		const bankCode = bank.code;
		const bankProvider = bank.provider;
		const accountName =
			accountNumberAttrs.name || depositAccountAttrs.accountName;
		const currency = accountNumberAttrs.currency || "NGN";
		const status = accountNumberAttrs.status || "ACTIVE";
		const depositAccountId = depositAccountData.id;

		console.log(`📊 Webhook extracted details:`);
		console.log(`   Account Number: ${accountNumber}`);
		console.log(`   Bank Name: ${bankName}`);
		console.log(`   Bank Code: ${bankCode}`);
		console.log(`   Bank Provider: ${bankProvider}`);
		console.log(`   Account Name: ${accountName}`);
		console.log(`   Currency: ${currency}`);
		console.log(`   Status: ${status}`);
		console.log(`   Deposit Account ID: ${depositAccountId}`);

		// ✅ Find the user from metadata
		const metadata = accountNumberAttrs.metadata || {};
		const userId = metadata.userId;

		if (!userId) {
			console.error("❌ No userId found in webhook metadata");
			return;
		}

		// ✅ Check if virtual account already exists
		const existingAccount = await AnchorVirtualAccount.findOne({
			userId,
			anchorReference: depositAccountId,
			isActive: true,
		});

		if (existingAccount) {
			console.log(
				`✅ Virtual account already exists: ${existingAccount.accountNumber}`,
			);
			// Update with latest data from webhook
			existingAccount.accountNumber = accountNumber;
			existingAccount.bankName = bankName;
			existingAccount.bankCode = bankCode;
			existingAccount.accountName = accountName;
			await existingAccount.save();
			console.log(`✅ Updated virtual account with latest data`);
			return;
		}

		// ✅ Get the wallet
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			console.error(`❌ Wallet not found for user: ${userId}`);
			return;
		}

		// ✅ Create virtual account with EXACT data from webhook
		const virtualAccount = await AnchorVirtualAccount.create({
			userId,
			anchorCustomerId:
				depositAccountData.relationships?.customer?.data?.id || null,
			walletId: wallet._id,
			accountNumber: accountNumber,
			bankName: bankName, // ✅ EXACT from webhook - "PROVIDUS BANK"
			bankCode: bankCode, // ✅ EXACT from webhook - "000023"
			accountName: accountName,
			anchorReference: depositAccountId,
			isActive: true,
			isMock: false,
			provider: "anchor",
			currency: currency,
			metadata: {
				bankProvider: bankProvider,
				webhookId: payload.data?.id,
				webhookType: payload.data?.type,
				processedAt: new Date().toISOString(),
				rawData: {
					bank: bank,
					status: status,
				},
			},
		});

		console.log(`✅ Virtual account created from webhook:`);
		console.log(`   Account: ${virtualAccount.accountNumber}`);
		console.log(
			`   Bank: ${virtualAccount.bankName} (${virtualAccount.bankCode})`,
		);
		console.log(`   Name: ${virtualAccount.accountName}`);

		// ✅ Update wallet with bank details
		wallet.accountNumber = virtualAccount.accountNumber;
		wallet.bankName = virtualAccount.bankName;
		wallet.walletId = depositAccountId;
		wallet.isLocal = false;
		await wallet.save();

		console.log(`✅ Wallet updated with bank: ${wallet.bankName}`);

		// ✅ Send notification to user
		const user = await User.findById(userId);
		if (user) {
			await sendPushToUser(
				userId,
				"🏦 Virtual Account Ready",
				`Your virtual account ${accountNumber} (${bankName}) is ready to receive money.`,
				{
					type: "virtual_account_created",
					accountNumber: accountNumber,
					bankName: bankName,
				},
			);
		}
	} catch (error) {
		console.error("❌ Error processing accountNumber.created webhook:", error);
	}
}
