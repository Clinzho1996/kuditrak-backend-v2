import express from "express";

import {
	getUserBankAccounts,
	initiateBankLink,
	linkBankAccount,
	saveMonoCustomerId,
	syncMissingAccounts,
	unlinkAllBankAccounts,
	unlinkBankAccount,
} from "../controllers/bankController.js";
import { pullMonoTransactions } from "../controllers/transactionController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.post("/customer-id", protect, saveMonoCustomerId);
router.post("/link", protect, linkBankAccount);
router.post("/initiate", protect, initiateBankLink);

router.get("/", protect, getUserBankAccounts);
router.get("/sync", protect, syncMissingAccounts);
// Unlink a specific bank account
router.delete("/:accountId", protect, unlinkBankAccount);

// Unlink all bank accounts
router.delete("/all", protect, unlinkAllBankAccounts);
router.get("/:accountId/transactions", protect, pullMonoTransactions);

export default router;
