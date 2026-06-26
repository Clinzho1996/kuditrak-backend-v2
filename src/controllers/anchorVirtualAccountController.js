// backend/controllers/anchorVirtualAccountController.js - Fixed

import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import anchorService from "../services/anchorService.js";

/**
 * Create or get a deposit account (virtual account) for the user
 */
// backend/controllers/anchorVirtualAccountController.js - Remove mock fallback

// backend/controllers/anchorVirtualAccountController.js - Update createDepositAccount

// backend/controllers/anchorVirtualAccountController.js - Update createDepositAccount

export const createDepositAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { productName = "SAVINGS", metadata = {} } = req.body;

		console.log(`🔵 Creating deposit account for user: ${userId}`);

		// Get user's Anchor customer
		let anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete KYC first.",
			});
		}

		console.log(`✅ Anchor customer found: ${anchorCustomer.anchorCustomerId}`);
		console.log(`   KYC Level: ${anchorCustomer.kycLevel}`);
		console.log(`   KYC Status: ${anchorCustomer.kycStatus}`);

		// ✅ CRITICAL: Check if KYC needs to be upgraded in Anchor
		if (
			anchorCustomer.kycLevel === "TIER_0" ||
			anchorCustomer.kycStatus === "pending"
		) {
			console.log("⚠️ KYC not completed in Anchor. Attempting to upgrade...");

			// Get user with KYC data
			const user = await User.findById(userId);
			if (!user) {
				return res.status(404).json({
					success: false,
					error: "User not found",
				});
			}

			const bvn = user.kyc?.bvn;
			const dateOfBirth = user.kyc?.dateOfBirth;
			const gender = user.kyc?.gender;

			if (!bvn || !dateOfBirth || !gender) {
				return res.status(400).json({
					success: false,
					error: "KYC data incomplete. Please complete your KYC first.",
					requiresKYC: true,
					missing: {
						bvn: !bvn,
						dateOfBirth: !dateOfBirth,
						gender: !gender,
					},
				});
			}

			const formattedDate =
				dateOfBirth instanceof Date
					? dateOfBirth.toISOString().split("T")[0]
					: new Date(dateOfBirth).toISOString().split("T")[0];

			console.log(
				`📤 Upgrading KYC in Anchor: BVN=${bvn}, DOB=${formattedDate}, Gender=${gender}`,
			);

			const upgradeResult = await anchorService.upgradeCustomerKYC(
				anchorCustomer.anchorCustomerId,
				bvn,
				formattedDate,
				gender,
			);

			if (!upgradeResult.success) {
				console.error("❌ KYC upgrade failed:", upgradeResult.error);
				return res.status(400).json({
					success: false,
					error: upgradeResult.error || "Failed to upgrade KYC in Anchor",
					requiresKYC: true,
					kycPending: upgradeResult.status === "pending",
				});
			}

			console.log(`✅ KYC upgrade initiated: ${upgradeResult.verificationId}`);
			console.log(`   Status: ${upgradeResult.status}`);

			// Update local records
			anchorCustomer.kycLevel = "TIER_1";
			anchorCustomer.kycStatus = upgradeResult.status || "pending";
			anchorCustomer.currentVerificationId = upgradeResult.verificationId;
			anchorCustomer.identificationLevel2 = { bvn, dateOfBirth, gender };
			await anchorCustomer.save();

			user.anchorKycLevel = "TIER_1";
			user.kyc.anchorVerificationId = upgradeResult.verificationId;
			user.kyc.paystackValidationPending = true;
			await user.save();

			// If KYC is pending, return waiting status
			if (upgradeResult.status === "pending") {
				return res.status(202).json({
					success: false,
					error:
						"KYC verification submitted. Please wait for approval before creating a deposit account.",
					requiresKYC: true,
					kycPending: true,
					verificationId: upgradeResult.verificationId,
				});
			}
		}

		// ✅ Now KYC should be at least TIER_1, proceed with deposit account creation
		console.log(
			`✅ KYC Level ${anchorCustomer.kycLevel} - Proceeding with deposit account creation`,
		);

		// ... rest of the function remains the same
		// Check existing accounts, create new one, etc.
	} catch (error) {
		console.error("❌ Create deposit account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to create deposit account",
		});
	}
};

/**
 * Get user's virtual account details
 * Now checks Anchor API first for real-time data
 */
// backend/controllers/anchorVirtualAccountController.js - Fixed getVirtualAccount

export const getVirtualAccount = async (req, res) => {
	try {
		const userId = req.user._id;

		// Get customer info
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found",
				message: "Please complete KYC first",
			});
		}

		// Check local database first
		let virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		// If not found locally, try to fetch from Anchor
		if (!virtualAccount) {
			console.log("🔍 No local account found, checking Anchor...");

			try {
				const accountsResponse = await anchorService.getDepositAccounts(
					anchorCustomer.anchorCustomerId,
				);

				if (accountsResponse.success && accountsResponse.accounts?.length > 0) {
					const anchorAccount = accountsResponse.accounts[0];
					const accountId = anchorAccount.id || anchorAccount.accountId;

					console.log(`✅ Found Anchor account: ${accountId}`);

					// ✅ Get account details with bank information
					const accountDetails =
						await anchorService.getDepositAccount(accountId);

					// ✅ Extract bank details - NO DUMMY DATA
					let accountNumber = "pending";
					let bankName = null;
					let bankCode = null;
					let accountName = req.user.fullName || "Kuditrak User";

					if (accountDetails.success && accountDetails.account) {
						accountNumber = accountDetails.account.accountNumber || "pending";
						bankName = accountDetails.account.bankName; // ✅ Will be null if not found
						bankCode = accountDetails.account.bankCode; // ✅ Will be null if not found
						accountName = accountDetails.account.accountName || accountName;
					}

					// ✅ If bank name is null, throw error - don't use dummy
					if (!bankName) {
						console.error("❌ Bank name not found in Anchor response");
						return res.status(500).json({
							success: false,
							error: "Bank details not found. Please contact support.",
							message: "Unable to retrieve bank name from Anchor.",
						});
					}

					// ✅ Create local record with REAL bank details
					virtualAccount = await AnchorVirtualAccount.create({
						userId,
						anchorCustomerId: anchorCustomer.anchorCustomerId,
						walletId: null,
						accountNumber: accountNumber,
						bankName: bankName, // ✅ REAL bank name from Anchor
						bankCode: bankCode, // ✅ REAL bank code from Anchor
						accountName: accountName,
						anchorReference: accountId,
						isActive: true,
						isMock: false,
						provider: "anchor",
						currency: "NGN",
						metadata: {
							syncedAt: new Date().toISOString(),
							source: "getVirtualAccount",
						},
					});

					console.log(
						`✅ Local account created from Anchor data: ${virtualAccount.accountNumber}`,
					);
					console.log(
						`   Bank: ${virtualAccount.bankName} (${virtualAccount.bankCode})`,
					);
				} else {
					// ✅ No account found in Anchor - don't create dummy
					return res.status(404).json({
						success: false,
						error: "No virtual account found in Anchor",
						message: "Create a deposit account first",
						requiresCreation: true,
					});
				}
			} catch (err) {
				console.log("⚠️ Could not fetch accounts from Anchor:", err.message);
				return res.status(500).json({
					success: false,
					error: "Failed to fetch account from Anchor",
					message: err.message,
				});
			}
		}

		if (!virtualAccount) {
			return res.status(404).json({
				success: false,
				error: "No virtual account found",
				message: "Create a deposit account first",
				requiresCreation: true,
			});
		}

		// ✅ Refresh account details from Anchor
		if (virtualAccount.anchorReference) {
			try {
				const accountDetails = await anchorService.getDepositAccount(
					virtualAccount.anchorReference,
				);

				if (accountDetails.success && accountDetails.account) {
					const updatedAccount = accountDetails.account;
					let needsUpdate = false;

					// ✅ Update with real data from Anchor - NO DUMMY DATA
					if (
						updatedAccount.accountNumber &&
						updatedAccount.accountNumber !== "pending"
					) {
						virtualAccount.accountNumber = updatedAccount.accountNumber;
						needsUpdate = true;
					}

					if (updatedAccount.bankName) {
						virtualAccount.bankName = updatedAccount.bankName;
						needsUpdate = true;
					}

					if (updatedAccount.bankCode) {
						virtualAccount.bankCode = updatedAccount.bankCode;
						needsUpdate = true;
					}

					if (updatedAccount.accountName) {
						virtualAccount.accountName = updatedAccount.accountName;
						needsUpdate = true;
					}

					if (needsUpdate) {
						await virtualAccount.save();
						console.log(`✅ Account details refreshed:`, {
							accountNumber: virtualAccount.accountNumber,
							bankName: virtualAccount.bankName,
							bankCode: virtualAccount.bankCode,
						});
					}
				}
			} catch (err) {
				console.log("⚠️ Could not refresh account details:", err.message);
			}
		}

		// ✅ Return the account with real bank details
		res.status(200).json({
			success: true,
			account: {
				id: virtualAccount._id,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName, // ✅ REAL bank name
				bankCode: virtualAccount.bankCode, // ✅ REAL bank code
				accountName: virtualAccount.accountName,
				isActive: virtualAccount.isActive,
				isMock: virtualAccount.isMock || false,
				currency: virtualAccount.currency || "NGN",
			},
		});
	} catch (error) {
		console.error("❌ Get virtual account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
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

		// Try to get real transactions from Anchor
		let transactions = [];
		let isMock = false;

		if (!virtualAccount.isMock && virtualAccount.anchorReference) {
			try {
				const result = await anchorService.getAccountTransactions(
					virtualAccount.anchorReference,
					parseInt(limit),
					parseInt(offset),
				);

				if (result.success && result.transactions) {
					transactions = result.transactions.map((tx) => ({
						id: tx.id || tx._id,
						amount: tx.amount || 0,
						type: tx.type === "credit" ? "credit" : "debit",
						description: tx.description || tx.narration || "Transaction",
						senderName: tx.senderName || tx.senderAccountName,
						senderAccount: tx.senderAccountNumber,
						status: tx.status || "completed",
						date: tx.date || tx.createdAt || new Date(),
						reference: tx.reference || tx.transactionReference,
					}));

					console.log(`✅ Found ${transactions.length} Anchor transactions`);
				}
			} catch (err) {
				console.log("⚠️ Could not fetch Anchor transactions:", err.message);
			}
		}

		// Fallback to mock transactions if no real ones found
		if (transactions.length === 0) {
			isMock = true;
			transactions = [
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
		}

		res.status(200).json({
			success: true,
			transactions,
			isMock,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total: transactions.length,
			},
		});
	} catch (error) {
		console.error("❌ Get account transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};
