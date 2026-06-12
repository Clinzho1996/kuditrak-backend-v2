// routes/webhookRoutes.js - Updated with charge.success handler
import axios from "axios";
import express from "express";
import { handleAnchorWebhook } from "../controllers/anchorWebhookController.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import userVirtualAccount from "../models/userVirtualAccount.js";
import Wallet from "../models/Wallet.js";
import { sendPushToUser } from "../services/pushService.js";

const router = express.Router();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

// Create virtual account after validation
const createVirtualAccountAfterValidation = async (customerCode, user) => {
	try {
		console.log(
			`Creating virtual account for validated customer: ${customerCode}`,
		);

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
			return virtualAccount;
		}
		return null;
	} catch (error) {
		console.error(
			"Create virtual account error:",
			error.response?.data || error.message,
		);
		return null;
	}
};

// Handle bank transfer funding (charge.success)
// In webhookRoutes.js, update the handleBankTransferFunding function

const handleBankTransferFunding = async (eventData) => {
	try {
		console.log("💰 Processing bank transfer funding...");

		const receiverAccountNumber =
			eventData.metadata?.receiver_account_number ||
			eventData.authorization?.receiver_bank_account_number;

		console.log("Receiver account number:", receiverAccountNumber);

		if (!receiverAccountNumber) {
			console.log("❌ No receiver account number found");
			return;
		}

		const virtualAccount = await userVirtualAccount.findOne({
			accountNumber: receiverAccountNumber,
			isActive: true,
		});

		if (!virtualAccount) {
			console.log(`❌ No virtual account found for: ${receiverAccountNumber}`);
			return;
		}

		console.log(`✅ Found virtual account for user: ${virtualAccount.userId}`);

		const wallet = await Wallet.findOne({ userId: virtualAccount.userId });

		if (!wallet) {
			console.log(`❌ No wallet found for user: ${virtualAccount.userId}`);
			return;
		}

		const amount = eventData.amount / 100;
		const paystackFee = eventData.fees / 100;
		const senderName = eventData.authorization?.sender_name || "Unknown";
		const senderAccount =
			eventData.authorization?.sender_bank_account_number || "Unknown";
		const senderBank = eventData.authorization?.sender_bank || "Unknown";

		console.log(
			`💰 Amount: ₦${amount}, Fee: ₦${paystackFee}, Sender: ${senderName}`,
		);

		// === ADD THE 0.5% PROCESSING FEE ===
		const processingFee = Math.floor(amount * 0.005); // 0.5% fee
		const amountToCredit = amount - processingFee;

		console.log(
			`💰 Processing fee (0.5%): ₦${processingFee}, Amount to credit: ₦${amountToCredit}`,
		);

		// Credit the user's wallet with fee deducted
		wallet.balance += amountToCredit;
		wallet.available += amountToCredit;
		await wallet.save();

		// Add processing fee to platform wallet
		let platformWallet = await Wallet.findOne({
			userId: process.env.SYSTEM_BUCKET_ID,
		});

		if (platformWallet) {
			platformWallet.balance += processingFee;
			platformWallet.available += processingFee;
			await platformWallet.save();
			console.log(
				`💰 Processing fee of ₦${processingFee} added to platform wallet`,
			);
		}

		// Create transaction record
		await Transaction.create({
			userId: virtualAccount.userId,
			walletId: wallet._id,
			transactionId: eventData.reference,
			type: "income",
			amount: amountToCredit,
			processingFee: processingFee,
			originalAmount: amount,
			status: "Completed",
			description: `Wallet top-up via bank transfer from ${senderName} (0.5% fee applied)`,
			source: "virtual_account",
			paystackFee: paystackFee,
			totalCharged: amount + paystackFee,
			paymentMethod: "bank_transfer",
			metadata: {
				paystackReference: eventData.reference,
				senderName: senderName,
				senderAccount: senderAccount,
				senderBank: senderBank,
				virtualAccountNumber: receiverAccountNumber,
				paystackFee: paystackFee,
				processingFee: processingFee,
				originalAmount: amount,
				amountCredited: amountToCredit,
			},
		});

		console.log(
			`✅ Wallet credited: +₦${amountToCredit} (after ₦${processingFee} fee), New balance: ₦${wallet.balance}`,
		);

		// Send push notification with correct amount
		try {
			await sendPushToUser(
				virtualAccount.userId,
				"💰 Wallet Funded!",
				`₦${amountToCredit.toLocaleString()} has been added to your wallet via bank transfer.`,
				{ type: "wallet_funded", screen: "wallet", amount: amountToCredit },
			);
			console.log("📱 Push notification sent");
		} catch (notifError) {
			console.error("Failed to send notification:", notifError);
		}
	} catch (error) {
		console.error("Error handling bank transfer funding:", error);
	}
};

// Main webhook handler
router.post("/paystack", async (req, res) => {
	try {
		const event = req.body;
		console.log("📨 Paystack webhook received:", event.event);

		// Handle customer identification events (KYC verification)
		if (event.event === "customeridentification.success") {
			const { customer_code, identification } = event.data;
			console.log(`✅ Customer validation successful for: ${customer_code}`);

			const user = await User.findOne({
				"kyc.paystackCustomerCode": customer_code,
			});

			if (user) {
				user.kyc.paystackValidated = true;
				user.kyc.paystackValidationPending = false;
				user.kyc.isVerified = true;
				user.kyc.verifiedAt = new Date();
				user.kyc.bvnVerified = true;
				await user.save();

				console.log(`✅ User ${user._id} KYC verified`);

				// Create virtual account for user
				await createVirtualAccountAfterValidation(customer_code, user);

				// Send notification
				await sendPushToUser(
					user._id,
					"✅ KYC Verified!",
					"Your KYC has been verified. You can now fund your wallet via bank transfer!",
					{ type: "kyc_complete", screen: "topup" },
				);
			}
		}
		// Handle customer identification failure
		else if (event.event === "customeridentification.failed") {
			const { customer_code, reason } = event.data;
			console.log(`❌ Customer validation failed: ${reason}`);

			const user = await User.findOne({
				"kyc.paystackCustomerCode": customer_code,
			});
			if (user) {
				user.kyc.paystackValidationPending = false;
				user.kyc.validationError = reason;
				await user.save();
			}
		}
		// Handle bank transfer funding (charge.success for virtual accounts)
		else if (event.event === "charge.success") {
			// Check if this is a virtual account transfer
			const isVirtualAccountTransfer =
				event.data.channel === "dedicated_nuban" ||
				event.data.authorization?.channel === "dedicated_nuban";

			if (isVirtualAccountTransfer) {
				console.log("💰 Processing virtual account transfer...");
				await handleBankTransferFunding(event.data);
			} else {
				console.log("ℹ️ Non-virtual account charge, skipping");
			}
		}

		// Always return 200 to acknowledge receipt
		res.sendStatus(200);
	} catch (error) {
		console.error("Webhook error:", error);
		res.sendStatus(500);
	}
});

router.post("/anchor", handleAnchorWebhook);

export default router;
