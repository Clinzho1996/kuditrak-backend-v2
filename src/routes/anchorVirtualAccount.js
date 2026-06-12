// backend/routes/anchorVirtualAccountRoutes.js
import express from "express";
import {
	createDepositAccount,
	getAccountTransactions,
	getVirtualAccount,
} from "../controllers/anchorVirtualAccountController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.post("/create", createDepositAccount);
router.get("/my-account", getVirtualAccount);
router.get("/transactions", getAccountTransactions);

export default router;
