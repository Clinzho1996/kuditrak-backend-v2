// backend/routes/anchorWalletRoutes.js
import express from "express";
import {
	createSubAccount,
	fundSubAccount,
	getSubAccounts,
	getWalletBalance,
	getWalletTransactions,
	lockSubAccount,
	withdrawFromSubAccount,
} from "../controllers/anchorWalletController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Wallet
router.get("/balance", getWalletBalance);
router.get("/transactions", getWalletTransactions);

// Sub-accounts
router.get("/sub-accounts", getSubAccounts);
router.post("/sub-accounts", createSubAccount);
router.post("/sub-accounts/fund", fundSubAccount);
router.post("/sub-accounts/withdraw", withdrawFromSubAccount);
router.post("/sub-accounts/lock", lockSubAccount);

export default router;
