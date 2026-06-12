// controllers/walletController.js
import axios from "axios";
import mongoose from "mongoose";
import BankConnection from "../models/BankConnection.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import userVirtualAccount from "../models/userVirtualAccount.js";
import Wallet from "../models/Wallet.js";
import {
	createVirtualAccount,
	getOrCreateVirtualAccount,
	getUserVirtualAccount,
} from "../services/dvaService.js";
import { sendTopUpNotification } from "../services/notificationService.js";
import {
	createTopUp,
	getOrCreateRecipient,
	initiatePayout,
} from "../services/paymentGateway.js";

// ================= DVA (Dedicated Virtual Account) Methods =================
// controllers/walletController.js - Updated getVirtualAccount

export const getVirtualAccount = async (req, res) => {
	try {
		// First, check if user has completed KYC
		const user = req.user;

		// Fetch fresh user data to get KYC status
		const freshUser = await User.findById(user._id);

		const hasKYC =
			freshUser.kyc?.isVerified &&
			freshUser.kyc?.bvnVerified &&
			freshUser.kyc?.address?.street &&
			freshUser.kyc?.identification?.type;

		if (!hasKYC) {
			return res.json({
				success: false,
				requiresKYC: true,
				message:
					"KYC verification required to use bank transfer funding. Please complete your KYC in profile settings.",
				fallbackToCard: true,
			});
		}

		// Check if KYC was just verified but virtual account not created yet
		const existingVirtualAccount = await getUserVirtualAccount(user._id);

		if (existingVirtualAccount) {
			return res.json({
				success: true,
				available: true,
				accountNumber: existingVirtualAccount.accountNumber,
				bankName: existingVirtualAccount.bankName,
				accountName: existingVirtualAccount.accountName,
				provider: existingVirtualAccount.provider,
			});
		}

		// Check if there's a pending validation
		if (freshUser.kyc?.paystackValidationPending) {
			return res.json({
				success: false,
				pendingValidation: true,
				message:
					"Your KYC is being verified. This may take a few minutes. Please check back later.",
				fallbackToCard: true,
			});
		}

		// Attempt to create virtual account
		const result = await getOrCreateVirtualAccount(freshUser);

		if (result && result.success) {
			return res.json({
				success: true,
				available: true,
				accountNumber: result.accountNumber,
				bankName: result.bankName,
				accountName: result.accountName,
				provider: result.provider,
			});
		} else if (result && result.pendingValidation) {
			return res.json({
				success: false,
				pendingValidation: true,
				message:
					result.message ||
					"Customer validation pending. Please wait for verification.",
				fallbackToCard: true,
			});
		} else {
			return res.json({
				success: false,
				available: false,
				message:
					result?.error ||
					"Bank transfer not available. Please use card payment.",
				fallbackToCard: true,
			});
		}
	} catch (err) {
		console.error("Get virtual account error:", err);
		res.json({
			success: false,
			available: false,
			message:
				"Bank transfer temporarily unavailable. Please use card payment.",
			fallbackToCard: true,
		});
	}
};

// Webhook handler for DVA credits (Paystack sends this when money is received)
export const handleDvaWebhook = async (req, res) => {
	try {
		const event = req.body;
		console.log("DVA Webhook received:", event.event);

		if (event.event === "charge.success") {
			const data = event.data;
			const amountReceived = data.amount / 100;
			const paystackFee = data.fee / 100;

			const virtualAccount = await userVirtualAccount.findOne({
				accountNumber: data.authorization.receiver_bank_account_number,
				isActive: true,
			});

			if (virtualAccount) {
				console.log(
					`Processing DVA credit: ₦${amountReceived} for user ${virtualAccount.userId}`,
				);

				const wallet = await Wallet.findOne({ userId: virtualAccount.userId });

				if (wallet) {
					const processingFee = Math.floor(amountReceived * 0.005);
					const amountToCredit = amountReceived - processingFee;

					wallet.balance += amountToCredit;
					wallet.available += amountToCredit;
					await wallet.save();

					await Transaction.create({
						walletId: wallet._id,
						userId: virtualAccount.userId,
						transactionId: `DVA-${data.reference}-${Date.now()}`,
						type: "income",
						amount: amountToCredit,
						processingFee: processingFee,
						originalAmount: amountReceived,
						paystackFee: paystackFee,
						source: "virtual_account",
						status: "Completed",
						description: `Wallet top-up via ${virtualAccount.bankName} transfer (0.5% fee applied)`,
						metadata: {
							paystackReference: data.reference,
							paystackFee: paystackFee,
							processingFee: processingFee,
							accountNumber: virtualAccount.accountNumber,
							bankName: virtualAccount.bankName,
							originalAmount: amountReceived,
							amountCredited: amountToCredit,
						},
					});

					let platformWallet = await Wallet.findOne({
						userId: process.env.SYSTEM_BUCKET_ID,
					});
					if (platformWallet) {
						platformWallet.balance += processingFee;
						platformWallet.available += processingFee;
						await platformWallet.save();
					}

					// FIXED: Send amountToCredit instead of amountReceived
					await sendTopUpNotification(
						virtualAccount.userId,
						amountToCredit,
						wallet.balance,
					);

					console.log(
						`✅ User wallet credited: +₦${amountToCredit} (after ₦${processingFee} fee). New balance: ₦${wallet.balance}`,
					);
				} else {
					console.error(`Wallet not found for user ${virtualAccount.userId}`);
				}
			} else {
				console.error(
					`Virtual account not found: ${data.authorization.receiver_bank_account_number}`,
				);
			}
		}

		res.sendStatus(200);
	} catch (error) {
		console.error("Handle DVA webhook error:", error);
		res.sendStatus(500);
	}
};

export const topUpWallet = async (req, res) => {
	try {
		const { amount } = req.body;
		const userId = req.user._id;

		// Calculate Paystack fee (1.5% + ₦100, capped at ₦2,000)
		const calculatePaystackFee = (amt) => {
			const percentage = amt * 0.015;
			const flatFee = 100;
			const total = percentage + flatFee;
			return Math.min(total, 2000);
		};

		const paystackFee = calculatePaystackFee(amount);
		const totalToCharge = amount + paystackFee;

		const reference = `CARD-${Date.now()}-${userId.toString().substring(0, 8)}`;

		const { paymentLink } = await createTopUp({
			email: req.user.email,
			amount: totalToCharge,
			reference,
			userId: userId,
		});

		const wallet = await Wallet.findOne({ userId: req.user._id });

		await Transaction.create({
			userId: req.user._id,
			walletId: wallet._id,
			transactionId: reference,
			type: "income",
			amount: amount,
			paystackFee: paystackFee,
			totalCharged: totalToCharge,
			source: "card",
			status: "Pending",
			description: "Wallet Top Up (Card)",
		});

		res.json({ paymentLink, reference, fee: paystackFee, totalToCharge });
	} catch (err) {
		console.error("Topup error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const verifyWalletTopUp = async (req, res) => {
	try {
		const reference =
			req.query.reference || req.query.trxref || req.body.reference;

		console.log("🔔 VerifyWalletTopUp called");
		console.log("Reference:", reference);

		if (!reference) {
			console.error("No reference provided");
			return res.redirect("kuditrak://payment/failed?error=missing_reference");
		}

		const verification = await verifyWithPaystack(reference);

		if (!verification.status || verification.data.status !== "success") {
			console.error("Payment verification failed");
			return res.redirect(
				`kuditrak://payment/failed?reference=${reference}&error=verification_failed`,
			);
		}

		const transaction = await Transaction.findOne({ transactionId: reference });

		if (!transaction) {
			console.error("Transaction not found:", reference);
			return res.redirect(
				"kuditrak://payment/failed?error=transaction_not_found",
			);
		}

		const wallet = await Wallet.findOne({ userId: transaction.userId });

		if (!wallet) {
			console.error("Wallet not found for user:", transaction.userId);
			return res.redirect("kuditrak://payment/failed?error=wallet_not_found");
		}

		if (transaction.status === "Completed") {
			console.log("Transaction already processed");
			return res.redirect(
				`kuditrak://payment/success?reference=${reference}&amount=${transaction.amount}`,
			);
		}

		const amount = transaction.amount; // This is the amount user receives (₦500)
		const paystackFee = transaction.paystackFee; // This is the Paystack fee (₦107.50)

		// Get or create platform wallet (system bucket)
		let platformWallet = await Wallet.findOne({
			userId: process.env.SYSTEM_BUCKET_ID,
		});

		if (!platformWallet) {
			platformWallet = await Wallet.create({
				userId: process.env.SYSTEM_BUCKET_ID,
				balance: 0,
				available: 0,
				allocated: 0,
				currency: "NGN",
			});
		}

		// Send the ENTIRE Paystack fee to system bucket
		if (paystackFee > 0) {
			platformWallet.balance += paystackFee;
			platformWallet.available += paystackFee;
			await platformWallet.save();

			console.log(
				`💰 Platform wallet received full Paystack fee: ₦${paystackFee}`,
			);
		}

		// Credit user's wallet with the full amount (no deduction)
		wallet.balance += amount;
		wallet.available += amount;
		await wallet.save();

		transaction.status = "Completed";
		await transaction.save();

		// Create platform revenue transaction record for the Paystack fee
		if (paystackFee > 0) {
			await Transaction.create({
				walletId: platformWallet._id,
				userId: process.env.SYSTEM_BUCKET_ID,
				transactionId: `PLATFORM-CARD-FEE-${reference}`,
				type: "income",
				amount: paystackFee,
				status: "Completed",
				description: `Paystack fee from card top-up by user ${transaction.userId}`,
				source: "platform",
				metadata: {
					userId: transaction.userId,
					originalTopUpAmount: amount,
					paystackFee: paystackFee,
					totalUserPaid: transaction.totalCharged,
					cardReference: reference,
				},
			});
		}

		console.log(
			`✅ Wallet funded: +₦${amount}, New balance: ₦${wallet.balance}`,
		);
		console.log(`💰 Platform wallet balance: ₦${platformWallet.balance}`);

		try {
			await sendTopUpNotification(transaction.userId, amount, wallet.balance);
		} catch (notifError) {
			console.error("Notification error:", notifError);
		}

		const appDeepLink = `kuditrak://payment/success?reference=${reference}&amount=${amount}`;
		console.log("🔗 Redirecting to app:", appDeepLink);

		return res.redirect(appDeepLink);
	} catch (error) {
		console.error("Verify wallet topup error:", error.message);
		const reference = req.query?.reference || req.query?.trxref || "unknown";
		return res.redirect(
			`kuditrak://payment/failed?reference=${reference}&error=${encodeURIComponent(error.message)}`,
		);
	}
};

// Helper function to verify with Paystack
const verifyWithPaystack = async (reference) => {
	try {
		const response = await axios.get(
			`https://api.paystack.co/transaction/verify/${reference}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);
		return response.data;
	} catch (error) {
		console.error(
			"Paystack verification error:",
			error.response?.data || error.message,
		);
		throw new Error("Failed to verify payment with Paystack");
	}
};

// ================= Existing Methods =================

export const transferFunds = async (req, res) => {
	const { recipientId, amount } = req.body;
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const senderWallet = await Wallet.findOne({ userId: req.user._id }).session(
			session,
		);
		const recipientWallet = await Wallet.findOne({
			userId: recipientId,
		}).session(session);
		if (!recipientWallet) throw new Error("Recipient not found");
		if (senderWallet.available < amount)
			throw new Error("Insufficient balance");

		senderWallet.balance -= amount;
		senderWallet.available -= amount;
		recipientWallet.balance += amount;
		recipientWallet.available += amount;

		await senderWallet.save({ session });
		await recipientWallet.save({ session });

		await Transaction.create(
			[
				{
					walletId: senderWallet._id,
					userId: req.user._id,
					type: "expense",
					amount,
					status: "Completed",
					description: `Transfer to user ${recipientId}`,
					source: "wallet",
					metadata: {
						fromUserId: req.user._id,
						toUserId: recipientId,
						reference: `TRX-${Date.now()}`,
					},
				},
			],
			{ session },
		);

		await session.commitTransaction();
		session.endSession();
		res.status(200).json({ success: true, message: "Transfer successful" });
	} catch (err) {
		await session.abortTransaction();
		session.endSession();
		res.status(400).json({ success: false, error: err.message });
	}
};

export const allocateSavings = async (req, res) => {
	const { bucketId, amount } = req.body;
	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const wallet = await Wallet.findOne({ userId: req.user._id }).session(
			session,
		);
		if (!wallet) throw new Error("Wallet not found");
		if (Number(wallet.available) < Number(amount))
			throw new Error("Insufficient balance");

		const bucket = await SavingsBucket.findOne({
			_id: bucketId,
			userId: req.user._id,
		}).session(session);
		if (!bucket) throw new Error("Bucket not found");

		wallet.allocated = Number(wallet.allocated || 0) + Number(amount);
		wallet.available = Number(wallet.available || 0) - Number(amount);
		await wallet.save({ session });

		bucket.currentAmount = Number(bucket.currentAmount || 0) + Number(amount);
		await bucket.save({ session });

		const transactionId = `TRX-${req.user._id}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

		await Transaction.create(
			[
				{
					walletId: wallet._id,
					userId: req.user._id,
					transactionId,
					type: "expense",
					amount: Number(amount),
					status: "Completed",
					description: "Savings allocation",
					source: "wallet",
					metadata: { bucketId, reference: transactionId },
				},
			],
			{ session },
		);

		await session.commitTransaction();
		session.endSession();

		res.status(200).json({
			success: true,
			message: "Allocated to savings bucket",
			bucket,
			wallet,
		});
	} catch (err) {
		await session.abortTransaction();
		session.endSession();
		res.status(400).json({ success: false, error: err.message });
	}
};

export const getBalance = async (req, res) => {
	const wallet = await Wallet.findOne({ userId: req.user._id });
	res.status(200).json({
		success: true,
		balance: wallet.balance,
		allocated: wallet.allocated,
		available: wallet.available,
	});
};

export const withdrawToBank = async (req, res) => {
	const { amount, bankAccountId } = req.body;
	const AMOUNT = Number(amount);

	// Calculate Paystack's actual transfer cost
	const calculatePaystackTransferCost = (amt) => {
		let transferFee = 0;
		if (amt <= 5000) {
			transferFee = 10;
		} else if (amt <= 50000) {
			transferFee = 25;
		} else {
			transferFee = 50;
		}
		const stampDuty = amt >= 10000 ? 50 : 0;
		return transferFee + stampDuty;
	};

	// Calculate your app's service fee (your profit)
	const calculateServiceFee = (amt) => {
		if (amt <= 10000) return 50;
		if (amt <= 100000) return 100;
		if (amt <= 500000) return 200;
		if (amt <= 1000000) return 300;
		return Math.min(Math.ceil(amt * 0.002), 500);
	};

	const PAYSTACK_COST = calculatePaystackTransferCost(AMOUNT);
	const SERVICE_FEE = calculateServiceFee(AMOUNT);
	const TOTAL_FEE = PAYSTACK_COST + SERVICE_FEE;

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		// Get user's wallet
		const wallet = await Wallet.findOne({ userId: req.user._id }).session(
			session,
		);
		if (!wallet) throw new Error("Wallet not found");

		// Get or create platform wallet (for your company revenue)
		let platformWallet = await Wallet.findOne({
			userId: process.env.SYSTEM_BUCKET_ID,
		}).session(session);

		if (!platformWallet) {
			platformWallet = await Wallet.create({
				userId: process.env.SYSTEM_BUCKET_ID,
				balance: 0,
				available: 0,
				allocated: 0,
				currency: "NGN",
			});
		}

		const totalDeduction = AMOUNT + TOTAL_FEE;

		if (wallet.available < totalDeduction) {
			throw new Error(
				`Insufficient balance. You need ₦${totalDeduction} to receive ₦${AMOUNT} (includes ₦${TOTAL_FEE} fee)`,
			);
		}

		const bankAccount = await BankConnection.findOne({
			_id: bankAccountId,
			userId: req.user._id,
			status: "Active",
		}).session(session);

		if (!bankAccount) throw new Error("Bank account not found");

		// Get or create recipient
		let recipientResult;
		try {
			recipientResult = await getOrCreateRecipient(bankAccount);
		} catch (recipientError) {
			console.error("Failed to get/create recipient:", recipientError);
			throw new Error("Unable to process withdrawal. Please try again later.");
		}

		if (!recipientResult.success) {
			throw new Error(
				recipientResult.message || "Failed to create withdrawal recipient",
			);
		}

		// Initiate payout to user's bank
		const payoutReference = `PAYOUT-${req.user._id}-${Date.now()}`;
		const payoutResult = await initiatePayout({
			amount: AMOUNT,
			userId: req.user._id,
			bankAccountId,
			recipientCode: recipientResult.recipientCode,
			reference: payoutReference,
		});

		if (!payoutResult.success) throw new Error(payoutResult.message);

		// DEDUCT FROM USER'S WALLET
		wallet.balance -= totalDeduction;
		wallet.available -= totalDeduction;
		await wallet.save({ session });

		// ADD SERVICE FEE TO PLATFORM WALLET (YOUR REVENUE)
		if (SERVICE_FEE > 0) {
			platformWallet.balance += SERVICE_FEE;
			platformWallet.available += SERVICE_FEE;
			await platformWallet.save({ session });

			console.log(`💰 Service fee of ₦${SERVICE_FEE} added to platform wallet`);
		}

		// Record user withdrawal transaction
		await Transaction.create(
			[
				{
					walletId: wallet._id,
					userId: req.user._id,
					transactionId: payoutReference,
					type: "expense",
					amount: AMOUNT,
					status: "Completed",
					description: `Withdrawal to ${bankAccount.bankName} - ${bankAccount.accountNumber}`,
					source: "wallet",
					metadata: {
						bankAccountId,
						bankName: bankAccount.bankName,
						accountNumber: bankAccount.accountNumber,
						reference: payoutReference,
						totalFee: TOTAL_FEE,
						paystackCost: PAYSTACK_COST,
						serviceFee: SERVICE_FEE,
						totalDeduction,
						amountSent: AMOUNT,
					},
				},
			],
			{ session },
		);

		// Record platform revenue transaction (optional)
		if (SERVICE_FEE > 0) {
			await Transaction.create(
				[
					{
						walletId: platformWallet._id,
						userId: process.env.SYSTEM_BUCKET_ID,
						transactionId: `PLATFORM-REVENUE-${req.user._id}-${Date.now()}`,
						type: "income",
						amount: SERVICE_FEE,
						status: "Completed",
						description: `Service fee from withdrawal by user ${req.user._id}`,
						source: "platform",
						metadata: {
							userId: req.user._id,
							withdrawalAmount: AMOUNT,
							serviceFee: SERVICE_FEE,
							paystackCost: PAYSTACK_COST,
						},
					},
				],
				{ session },
			);
		}

		await session.commitTransaction();
		session.endSession();

		res.status(200).json({
			success: true,
			message: `Withdrawal of ₦${AMOUNT} processed. Fee: ₦${TOTAL_FEE} (₦${PAYSTACK_COST} Paystack + ₦${SERVICE_FEE} service fee)`,
			amount: AMOUNT,
			fee: TOTAL_FEE,
			paystackCost: PAYSTACK_COST,
			serviceFee: SERVICE_FEE,
			amountSent: AMOUNT,
			totalDeduction,
			balance: wallet.balance,
			platformBalance: platformWallet.balance,
			payoutReference: payoutResult.transferReference,
			wallet: {
				balance: wallet.balance,
				allocated: wallet.allocated,
				available: wallet.available,
			},
		});
	} catch (err) {
		await session.abortTransaction();
		session.endSession();
		console.error("Withdrawal error:", err.message);
		res.status(400).json({
			success: false,
			message: err.message,
			error: err.message,
		});
	}
};

// controllers/walletController.js - Add this endpoint

export const checkVirtualAccountStatus = async (req, res) => {
	try {
		const user = req.user;

		// Check if user has pending validation
		if (user.kyc?.paystackValidationPending) {
			return res.json({
				success: false,
				pendingValidation: true,
				message: "KYC validation in progress. Please wait...",
			});
		}

		// Check if user is validated
		if (user.kyc?.paystackValidated) {
			// Try to get or create virtual account
			const virtualAccount = await getUserVirtualAccount(user._id);

			if (virtualAccount) {
				return res.json({
					success: true,
					available: true,
					accountNumber: virtualAccount.accountNumber,
					bankName: virtualAccount.bankName,
					accountName: virtualAccount.accountName,
					provider: virtualAccount.provider,
				});
			} else {
				// Create virtual account if validated but not created yet
				const result = await createVirtualAccount(user);
				if (result.success) {
					return res.json({
						success: true,
						available: true,
						accountNumber: result.accountNumber,
						bankName: result.bankName,
						accountName: result.accountName,
						provider: result.provider,
					});
				}
			}
		}

		// Default response
		res.json({
			success: false,
			available: false,
			message: "Virtual account not available yet. Please try again later.",
		});
	} catch (err) {
		console.error("Check virtual account status error:", err);
		res.status(500).json({ error: err.message });
	}
};
