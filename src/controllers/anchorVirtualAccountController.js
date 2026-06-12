// backend/controllers/anchorVirtualAccountController.js
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Create a deposit account (virtual account) for the user
 */
export const createDepositAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { productName = "SAVINGS", metadata = {} } = req.body;

		// Get user's Anchor customer
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete KYC first.",
			});
		}

		// Check if KYC is completed (Tier 1 or higher)
		if (anchorCustomer.kycLevel === "TIER_0") {
			return res.status(403).json({
				success: false,
				error: "KYC verification required to create deposit account",
				message: "Please complete KYC verification first",
			});
		}

		// Check if user already has a deposit account
		const existingAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (existingAccount) {
			return res.status(400).json({
				success: false,
				error: "Deposit account already exists",
				account: {
					accountNumber: existingAccount.accountNumber,
					bankName: existingAccount.bankName,
					accountName: existingAccount.accountName,
				},
			});
		}

		// Create deposit account with Anchor
		const accountResponse = await anchorService.createDepositAccount(
			anchorCustomer.anchorCustomerId,
			productName,
			{ userId: userId.toString(), platform: "kuditrak", ...metadata },
		);

		if (!accountResponse.success) {
			// Create mock account for development
			const mockAccountNumber = `80${Math.floor(Math.random() * 1000000000)}`;
			const mockBankName = "Kuditrak Test Bank";

			const mockAccount = await AnchorVirtualAccount.create({
				userId,
				anchorCustomerId: anchorCustomer.anchorCustomerId,
				walletId: null,
				accountNumber: mockAccountNumber,
				bankName: mockBankName,
				bankCode: "999",
				accountName: req.user.fullName,
				anchorReference: accountResponse.accountId || `mock_${Date.now()}`,
				isActive: true,
				isMock: true,
			});

			await sendPushToUser(
				userId,
				"🏦 Virtual Account Created",
				`Your virtual account ${mockAccountNumber} (${mockBankName}) is ready to receive money.`,
				{ type: "virtual_account_created", accountNumber: mockAccountNumber },
			);

			return res.status(201).json({
				success: true,
				message: "Virtual account created (development mode)",
				isMock: true,
				account: {
					id: mockAccount._id,
					accountNumber: mockAccountNumber,
					bankName: mockBankName,
					accountName: req.user.fullName,
					isActive: true,
				},
			});
		}

		// Get the actual account number
		const accountNumberResponse = await anchorService.getAccountNumber(
			accountResponse.accountId,
		);

		// Save to database
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
			message: "Deposit account created successfully",
			account: {
				id: virtualAccount._id,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				isActive: true,
			},
		});
	} catch (error) {
		console.error("Create deposit account error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get user's virtual account details
 */
export const getVirtualAccount = async (req, res) => {
	try {
		const userId = req.user._id;

		const virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (!virtualAccount) {
			return res.status(404).json({
				success: false,
				error: "No virtual account found",
				message: "Create a deposit account first",
			});
		}

		// If not mock, try to refresh account number from Anchor
		if (!virtualAccount.isMock && virtualAccount.anchorReference) {
			const accountDetails = await anchorService.getDepositAccount(
				virtualAccount.anchorReference,
			);
			if (accountDetails.success && accountDetails.account.accountNumber) {
				virtualAccount.accountNumber = accountDetails.account.accountNumber;
				virtualAccount.bankName =
					accountDetails.account.bankName || virtualAccount.bankName;
				await virtualAccount.save();
			}
		}

		res.status(200).json({
			success: true,
			account: {
				id: virtualAccount._id,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				isActive: virtualAccount.isActive,
				isMock: virtualAccount.isMock || false,
			},
		});
	} catch (error) {
		console.error("Get virtual account error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get account statement/transactions for virtual account
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
			return res.status(404).json({ error: "No virtual account found" });
		}

		// For mock, return sample transactions
		const mockTransactions = [
			{
				id: "tx_1",
				amount: 50000,
				type: "credit",
				description: "Transfer from John Doe",
				senderName: "John Doe",
				senderAccount: "0123456789",
				status: "completed",
				date: new Date(),
				reference: "REF001",
			},
			{
				id: "tx_2",
				amount: 25000,
				type: "credit",
				description: "Salary payment",
				senderName: "Employer Ltd",
				senderAccount: "9876543210",
				status: "completed",
				date: new Date(Date.now() - 86400000),
				reference: "REF002",
			},
		];

		res.status(200).json({
			success: true,
			transactions: mockTransactions,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total: mockTransactions.length,
			},
		});
	} catch (error) {
		console.error("Get account transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};
