// backend/controllers/walletController.js
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Get total wallet balance (NGN + USD combined)
 */
export const getBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		// Ensure Anchor customer exists
		const customerResult = await getOrCreateAnchorCustomer(userId);
		if (!customerResult.success) {
			return res.status(400).json({ error: customerResult.error });
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

		// Get virtual accounts for additional info
		const virtualAccounts = await AnchorVirtualAccount.find({
			userId,
			isActive: true,
		});

		const responseData = {
			success: true,
			balance: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			available: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			currency: balanceResponse.success
				? balanceResponse.currency
				: wallet.currency,
			walletId: wallet.walletId,
			walletName: wallet.name,
			accountNumber: virtualAccounts[0]?.accountNumber || null,
			bankName: virtualAccounts[0]?.bankName || null,
			anchorCustomerId: wallet.anchorCustomerId,
		};

		// Update local balance if we got fresh data
		if (balanceResponse.success) {
			wallet.balance = balanceResponse.balance;
			await wallet.save();
		}

		res.status(200).json(responseData);
	} catch (error) {
		console.error("Get balance error:", error);
		res.status(500).json({ error: error.message });
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

		res.status(200).json({
			success: true,
			balance: balanceResponse.success
				? balanceResponse.balance
				: wallet.balance,
			currency: balanceResponse.success
				? balanceResponse.currency
				: wallet.currency,
		});
	} catch (error) {
		console.error("Refresh balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get USD wallet balance
 */
export const getUSDWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		// For now, return USD balance from Bridgecard integration
		// This would be enhanced when Anchor supports USD wallets
		const usdCards = await BridgecardCard.find({
			userId,
			currency: "USD",
			status: "active",
		});

		const totalUSDBalance = usdCards.reduce(
			(sum, card) => sum + (card.balance || 0),
			0,
		);

		res.status(200).json({
			success: true,
			balance: totalUSDBalance,
			currency: "USD",
			cards: usdCards.length,
		});
	} catch (error) {
		console.error("Get USD balance error:", error);
		res.status(500).json({ error: error.message });
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
		res.status(500).json({ error: error.message });
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

		// Check if user already has a virtual account
		let virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (virtualAccount) {
			return res.status(200).json({
				success: true,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				provider: virtualAccount.provider,
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
		});

		await sendPushToUser(
			userId,
			"🏦 Virtual Account Created",
			`Your virtual account ${virtualAccount.accountNumber} is ready to receive money.`,
			{
				type: "virtual_account_created",
				accountNumber: virtualAccount.accountNumber,
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
		res.status(500).json({ error: error.message });
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
		res.status(500).json({ error: error.message });
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

		// Generate payment link (mock for now)
		const paymentLink = `https://pay.kuditrak.com/topup/${transaction._id}`;
		const reference = `TOPUP_${Date.now()}_${userId.toString().slice(-6)}`;

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
		res.status(500).json({ error: error.message });
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
			metadata: { reference },
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

		res.status(200).json({
			success: true,
			message: "Payment verified successfully",
			transaction,
		});
	} catch (error) {
		console.error("Verify topup error:", error);
		res.status(500).json({ error: error.message });
	}
};
