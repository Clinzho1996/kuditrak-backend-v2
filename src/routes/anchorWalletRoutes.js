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
	getNGNWalletBalance,
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
	topupWallet,
	unfreezeWallet,
	verifyTopup,
	withdrawFromSubAccount,
	withdrawToBank,
} from "../controllers/anchorWalletController.js";

import protect from "../middleware/auth.js";

const router = express.Router();

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

// ================= WITHDRAWALS =================
router.post("/withdraw", withdrawToBank);

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
