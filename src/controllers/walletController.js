// backend/controllers/walletController.js
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Get total wallet balance (NGN + USD combined)
 */
// backend/controllers/walletController.js - Updated getBalance

export const getBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		// Ensure Anchor customer exists
		const customerResult = await getOrCreateAnchorCustomer(userId);
		if (!customerResult.success) {
			return res.status(400).json({
				success: false,
				error: customerResult.error,
			});
		}

		// Get user's main wallet
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		// Get real-time balance from Anchor
		const balanceResponse = await anchorService.getWalletBalance(
			wallet.walletId,
		);

		// ✅ Get virtual accounts for account number
		const virtualAccounts = await AnchorVirtualAccount.find({
			userId,
			isActive: true,
		});

		// Get USD balance
		const usdBalance = await getUSDBalance(userId);

		// ✅ Use real account number from virtual accounts
		const accountNumber =
			virtualAccounts.length > 0 ? virtualAccounts[0].accountNumber : null;
		const bankName =
			virtualAccounts.length > 0 ? virtualAccounts[0].bankName : null;

		const responseData = {
			success: true,
			balance: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			available: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			designatedFunds: 0,
			ngnBalance: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			usdBalance: usdBalance,
			currency: "NGN",
			walletId: wallet.walletId,
			walletName: wallet.name,
			accountNumber: accountNumber, // ✅ Real account number
			bankName: bankName, // ✅ Real bank name
			anchorCustomerId: wallet.anchorCustomerId,
		};

		// Update local balance
		if (balanceResponse.success) {
			wallet.balance = balanceResponse.balance;
			await wallet.save();
		}

		res.status(200).json(responseData);
	} catch (error) {
		console.error("Get balance error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Refresh wallet balance
 */
export const refreshBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		const balanceResponse = await anchorService.getWalletBalance(
			wallet.walletId,
		);

		if (balanceResponse.success) {
			wallet.balance = balanceResponse.balance;
			await wallet.save();
		}

		const usdBalance = await getUSDBalance(userId);

		res.status(200).json({
			success: true,
			balance: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			usdBalance: usdBalance,
			currency: "NGN",
		});
	} catch (error) {
		console.error("Refresh balance error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get USD wallet balance
 */
export const getUSDWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;
		const usdBalance = await getUSDBalance(userId);

		res.status(200).json({
			success: true,
			balance: usdBalance,
			currency: "USD",
		});
	} catch (error) {
		console.error("Get USD balance error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get NGN wallet balance
 */
export const getNGNWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(200).json({
				success: true,
				balance: 0,
				currency: "NGN",
			});
		}

		const balanceResponse = await anchorService.getWalletBalance(
			wallet.walletId,
		);

		res.status(200).json({
			success: true,
			balance: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			currency: "NGN",
		});
	} catch (error) {
		console.error("Get NGN balance error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get USD balance from Bridgecard cards
 */
const getUSDBalance = async (userId) => {
	try {
		// Import BridgecardCard model
		const BridgecardCard = await import("../models/BridgecardCard.js").then(
			(m) => m.default,
		);

		const usdCards = await BridgecardCard.find({
			userId,
			currency: "USD",
			status: "active",
		});

		const totalUSDBalance = usdCards.reduce(
			(sum, card) => sum + (card.balance || 0),
			0,
		);
		return totalUSDBalance;
	} catch (error) {
		console.error("Error getting USD balance:", error);
		return 0;
	}
};

/**
 * List all virtual accounts
 */
export const listVirtualAccounts = async (req, res) => {
	try {
		const userId = req.user._id;

		const virtualAccounts = await AnchorVirtualAccount.find({
			userId,
			isActive: true,
		});

		const formattedAccounts = virtualAccounts.map((acc) => ({
			id: acc._id,
			accountNumber: acc.accountNumber,
			bankName: acc.bankName,
			accountName: acc.accountName,
			provider: acc.provider || "anchor",
			currency: acc.currency || "NGN",
			isActive: acc.isActive,
			isMock: acc.isMock || false,
		}));

		res.status(200).json({
			success: true,
			accounts: formattedAccounts,
			count: formattedAccounts.length,
		});
	} catch (error) {
		console.error("List virtual accounts error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get or create virtual account
 */
export const getVirtualAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { currency = "NGN" } = req.body;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete KYC first.",
			});
		}

		// Check if user already has a virtual account for this currency
		let virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
			currency: currency,
		});

		if (virtualAccount) {
			return res.status(200).json({
				success: true,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				provider: virtualAccount.provider || "anchor",
				currency: currency,
				isMock: virtualAccount.isMock || false,
			});
		}

		// Create new virtual account
		const accountResponse = await anchorService.createDepositAccount(
			anchorCustomer.anchorCustomerId,
			"SAVINGS",
			{ userId: userId.toString(), platform: "kuditrak", currency },
		);

		if (!accountResponse.success) {
			// Fallback to mock for development
			const mockAccountNumber = `80${Math.floor(Math.random() * 1000000000)}`;
			const mockBankName = "Kuditrak Test Bank";

			virtualAccount = await AnchorVirtualAccount.create({
				userId,
				anchorCustomerId: anchorCustomer.anchorCustomerId,
				walletId: null,
				accountNumber: mockAccountNumber,
				bankName: mockBankName,
				bankCode: "999",
				accountName: req.user.fullName,
				anchorReference: `mock_${Date.now()}`,
				isActive: true,
				isMock: true,
				provider: "anchor",
				currency: currency,
			});

			return res.status(201).json({
				success: true,
				accountNumber: mockAccountNumber,
				bankName: mockBankName,
				accountName: req.user.fullName,
				provider: "anchor",
				currency: currency,
				isMock: true,
			});
		}

		// Get the actual account number
		const accountNumberResponse = await anchorService.getAccountNumber(
			accountResponse.accountId,
		);

		virtualAccount = await AnchorVirtualAccount.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: null,
			accountNumber: accountNumberResponse.success
				? accountNumberResponse.accountNumber
				: "pending",
			bankName: accountNumberResponse.success
				? accountNumberResponse.bankName
				: "Anchor Bank",
			bankCode: "000",
			accountName: req.user.fullName,
			anchorReference: accountResponse.accountId,
			isActive: true,
			isMock: false,
			provider: "anchor",
			currency: currency,
		});

		await sendPushToUser(
			userId,
			"🏦 Virtual Account Created",
			`Your ${currency} virtual account ${virtualAccount.accountNumber} is ready to receive money.`,
			{
				type: "virtual_account_created",
				accountNumber: virtualAccount.accountNumber,
				currency: currency,
			},
		);

		res.status(201).json({
			success: true,
			accountNumber: virtualAccount.accountNumber,
			bankName: virtualAccount.bankName,
			accountName: virtualAccount.accountName,
			provider: virtualAccount.provider,
			currency: currency,
			isMock: false,
		});
	} catch (error) {
		console.error("Get virtual account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Top up wallet
 */
export const topupWallet = async (req, res) => {
	try {
		const userId = req.user._id;
		const { amount, currency = "NGN" } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Invalid amount",
			});
		}

		// Get wallet
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		// Create a transaction record
		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			amount,
			currency: currency,
			type: "credit",
			category: "deposit",
			status: "pending",
			description: `Wallet top-up of ${currency} ${amount}`,
			source: "manual",
			destination: "wallet",
		});

		// Generate payment link (mock for now - integrate with Paystack/Flutterwave)
		const paymentLink = `https://pay.kuditrak.com/topup/${transaction._id}`;
		const reference = `TOPUP_${Date.now()}_${userId.toString().slice(-6)}`;

		// Update transaction with reference
		transaction.metadata = { reference, paymentLink };
		await transaction.save();

		res.status(200).json({
			success: true,
			paymentLink,
			reference,
			transactionId: transaction._id,
			fee: 0,
			totalToCharge: amount,
		});
	} catch (error) {
		console.error("Topup wallet error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Verify topup
 */
export const verifyTopup = async (req, res) => {
	try {
		const userId = req.user._id;
		const { reference } = req.query;

		if (!reference) {
			return res.status(400).json({
				success: false,
				error: "Reference is required",
			});
		}

		// Find transaction
		const transaction = await AnchorTransaction.findOne({
			userId,
			"metadata.reference": reference,
		});

		if (!transaction) {
			return res.status(404).json({
				success: false,
				error: "Transaction not found",
			});
		}

		// Update transaction status
		transaction.status = "success";
		await transaction.save();

		// Update wallet balance
		const wallet = await AnchorWallet.findById(transaction.walletId);
		if (wallet) {
			wallet.balance += transaction.amount;
			await wallet.save();
		}

		await sendPushToUser(
			userId,
			"💰 Wallet Funded",
			`${transaction.currency} ${transaction.amount.toLocaleString()} has been added to your wallet.`,
			{
				type: "wallet_funded",
				amount: transaction.amount,
				currency: transaction.currency,
			},
		);

		res.status(200).json({
			success: true,
			message: "Payment verified successfully",
			transaction,
		});
	} catch (error) {
		console.error("Verify topup error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get wallet transactions (from Anchor)
 */
export const getWalletTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { limit = 50, offset = 0 } = req.query;

		const transactions = await AnchorTransaction.find({ userId })
			.sort({ createdAt: -1 })
			.limit(parseInt(limit))
			.skip(parseInt(offset))
			.lean();

		const total = await AnchorTransaction.countDocuments({ userId });

		res.status(200).json({
			success: true,
			transactions,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total,
				hasMore: offset + limit < total,
			},
		});
	} catch (error) {
		console.error("Get wallet transactions error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Create deposit account (virtual account)
 */
export const createDepositAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			productName = "SAVINGS",
			currency = "NGN",
			metadata = {},
		} = req.body;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete KYC first.",
			});
		}

		if (anchorCustomer.kycLevel === "TIER_0") {
			return res.status(403).json({
				success: false,
				error: "KYC verification required to create deposit account",
			});
		}

		const accountResponse = await anchorService.createDepositAccount(
			anchorCustomer.anchorCustomerId,
			productName,
			{
				userId: userId.toString(),
				platform: "kuditrak",
				currency,
				...metadata,
			},
		);

		if (!accountResponse.success) {
			return res.status(400).json({
				success: false,
				error: accountResponse.error,
			});
		}

		const accountNumberResponse = await anchorService.getAccountNumber(
			accountResponse.accountId,
		);

		const virtualAccount = await AnchorVirtualAccount.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: null,
			accountNumber: accountNumberResponse.success
				? accountNumberResponse.accountNumber
				: "pending",
			bankName: accountNumberResponse.success
				? accountNumberResponse.bankName
				: "Anchor Bank",
			bankCode: "000",
			accountName: req.user.fullName,
			anchorReference: accountResponse.accountId,
			isActive: true,
			isMock: false,
			provider: "anchor",
			currency: currency,
		});

		res.status(201).json({
			success: true,
			accountNumber: virtualAccount.accountNumber,
			bankName: virtualAccount.bankName,
			accountName: virtualAccount.accountName,
			provider: virtualAccount.provider,
			currency: currency,
			isActive: true,
		});
	} catch (error) {
		console.error("Create deposit account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get account transactions
 */
export const getAccountTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { limit = 50, offset = 0 } = req.query;

		const virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (!virtualAccount) {
			return res.status(404).json({
				success: false,
				error: "No virtual account found",
			});
		}

		const transactions = await AnchorTransaction.find({
			userId,
			virtualAccountId: virtualAccount._id,
		})
			.sort({ createdAt: -1 })
			.limit(parseInt(limit))
			.skip(parseInt(offset))
			.lean();

		const total = await AnchorTransaction.countDocuments({
			userId,
			virtualAccountId: virtualAccount._id,
		});

		res.status(200).json({
			success: true,
			transactions,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total,
				hasMore: offset + limit < total,
			},
		});
	} catch (error) {
		console.error("Get account transactions error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};
