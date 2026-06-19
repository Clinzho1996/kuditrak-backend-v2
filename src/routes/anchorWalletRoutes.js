// backend/routes/walletRoutes.js - Updated with Anchor integration
import express from "express";
import {
	createDepositAccount,
	getAccountTransactions,
	getVirtualAccount,
} from "../controllers/anchorVirtualAccountController.js";
import {
	createSubAccount,
	createWallet,
	fundSubAccount,
	getSubAccounts,
	getWalletTransactions,
	lockSubAccount,
	withdrawFromSubAccount,
} from "../controllers/anchorWalletController.js";
import {
	getBalance,
	getNGNWalletBalance,
	getUSDWalletBalance,
	listVirtualAccounts,
	refreshBalance,
	topupWallet,
	verifyTopup,
} from "../controllers/walletController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// ================= WALLET BALANCE =================
router.get("/balance", getBalance);
router.get("/balance/refresh", refreshBalance);
router.get("/balance/usd", getUSDWalletBalance);
router.get("/balance/ngn", getNGNWalletBalance);

// ================= VIRTUAL ACCOUNTS =================
router.get("/virtual-accounts", listVirtualAccounts);
router.post("/virtual-account", getVirtualAccount);
router.post("/virtual-account/create", createDepositAccount);
router.get("/virtual-account/transactions", getAccountTransactions);

// ================= TOP UP =================
router.post("/create", createWallet);
router.post("/topup", topupWallet);
router.get("/verify", verifyTopup);

// ================= SUB-ACCOUNTS =================
router.get("/sub-accounts", getSubAccounts);
router.post("/sub-accounts", createSubAccount);
router.post("/sub-accounts/fund", fundSubAccount);
router.post("/sub-accounts/withdraw", withdrawFromSubAccount);
router.post("/sub-accounts/lock", lockSubAccount);

// ================= TRANSACTIONS =================
router.get("/transactions", getWalletTransactions);

export default router;
