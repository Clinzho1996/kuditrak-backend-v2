// backend/routes/walletRoutes.js
import express from "express";
import {
	createSubAccount,
	createVirtualAccount,
	createWallet,
	exportTransactions,
	freezeWallet,
	fundSubAccount,
	getBalance,
	getBeneficiaries,
	getNGNWalletBalance,
	getRecentRecipients,
	getSubAccounts,
	getUSDWalletBalance,
	getWalletActivity,
	getWalletStatement,
	getWalletStats,
	getWalletTransactionById,
	getWalletTransactions,
	listVirtualAccounts,
	lockSubAccount,
	refreshBalance,
	sendToKuditrakUser,
	topupWallet,
	unfreezeWallet,
	verifyBankAccount,
	verifyTopup,
	withdrawFromSubAccount,
	withdrawToBank,
} from "../controllers/anchorWalletController.js";

import protect from "../middleware/auth.js";

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// ================= WALLET CREATION =================
router.post("/create", createWallet);

// ================= WALLET BALANCE =================
router.get("/balance", getBalance);
router.get("/balance/refresh", refreshBalance);
router.get("/balance/usd", getUSDWalletBalance);
router.get("/balance/ngn", getNGNWalletBalance);

// ================= WALLET MANAGEMENT =================
router.post("/freeze", freezeWallet);
router.post("/unfreeze", unfreezeWallet);
router.get("/stats", getWalletStats);
router.get("/activity", getWalletActivity);

// ================= VIRTUAL ACCOUNTS =================
router.get("/virtual-accounts", listVirtualAccounts);
router.post("/virtual-account/create", createVirtualAccount);

// ================= TOP UP =================
router.post("/topup", topupWallet);
router.get("/verify", verifyTopup);

// ================= SEND MONEY (Internal Transfers) =================
/**
 * Send money to another Kuditrak user
 * @route POST /api/wallet/send
 * @body { recipientEmail, recipientPhone, recipientHandle, amount, note }
 */
router.post("/send", sendToKuditrakUser);

/**
 * Get recent recipients (users you've sent money to)
 * @route GET /api/wallet/recipients
 * @query { limit }
 */
router.get("/recipients", getRecentRecipients);

// ================= WITHDRAWALS (Bank Transfers) =================
/**
 * Withdraw money to an external bank account
 * @route POST /api/wallet/withdraw/bank
 * @body { bankCode, bankName, accountNumber, accountName, amount, note, saveAsBeneficiary }
 */
router.post("/withdraw/bank", withdrawToBank);

/**
 * Verify a bank account before withdrawal
 * @route POST /api/wallet/verify/bank
 * @body { bankCode, accountNumber }
 */
router.post("/verify/bank", verifyBankAccount);

/**
 * Get saved beneficiaries (bank accounts you've withdrawn to)
 * @route GET /api/wallet/beneficiaries
 */
router.get("/beneficiaries", getBeneficiaries);

// ================= TRANSACTIONS =================
router.get("/transactions", getWalletTransactions);
router.get("/transactions/:id", getWalletTransactionById);
router.get("/transactions/export", exportTransactions);
router.get("/statement", getWalletStatement);

// ================= SUB-ACCOUNTS (Savings Goals) =================
router.get("/sub-accounts", getSubAccounts);
router.post("/sub-accounts", createSubAccount);
router.post("/sub-accounts/fund", fundSubAccount);
router.post("/sub-accounts/withdraw", withdrawFromSubAccount);
router.post("/sub-accounts/lock", lockSubAccount);

export default router;
