import express from "express";
import {
	createTransaction,
	deleteTransaction,
	getAllBankTransactions,
	getBudgetTransactions,
	getLinkedTransactions,
	getTransactionById,
	getTransactionHistory,
	getUnbudgetedTransactions,
	linkTransactionToBudget,
	listTransactions,
	pullAllMonoTransactions,
	pullMonoTransactions,
	syncBankTransactions,
	updateTransaction,
} from "../controllers/transactionController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Basic CRUD operations
router.get("/", listTransactions);
router.post("/create", createTransaction);
router.get("/history", getTransactionHistory);
router.get("/:id", getTransactionById);
router.put("/:id", updateTransaction);
router.delete("/:id", deleteTransaction);

// Budget related
router.post("/link-budget", linkTransactionToBudget);
router.get("/linked/budgeted", getBudgetTransactions);
router.get("/linked/unbudgeted", getUnbudgetedTransactions);
router.get("/linked", getLinkedTransactions);

// Bank/Mono related
router.get("/bank/all", getAllBankTransactions);
router.post("/bank/sync/:accountId", syncBankTransactions);
router.post("/bank/pull/:accountId", pullMonoTransactions);
router.post("/bank/pull-all/:accountId", pullAllMonoTransactions);

export default router;
