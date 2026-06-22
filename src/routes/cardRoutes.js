// backend/routes/cardRoutes.js
import express from "express";
import { getNGNCardTransactions } from "../controllers/bridgecardCardController.js";
import {
	createCard,
	deleteCard,
	freezeCard,
	fundCard,
	getBudgetDashboard,
	getCardBalance,
	getCardBudgetStatus,
	getCardCreationStatus,
	getCardDetails,
	getCardTransactions,
	getUserCards,
	unfreezeCard,
	unloadCard,
	updateCardBudget,
	updateCardPin,
} from "../controllers/cardCreationController.js";
import {
	fundUSDCardFromWallet,
	getExchangeRate,
} from "../controllers/cardFundingController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// ============= PUBLIC ROUTES (NO AUTH) =============
// ✅ Exchange rate - public endpoint
router.get("/exchange-rate", getExchangeRate);
router.get("/transactions", getNGNCardTransactions);

// ============= PROTECTED ROUTES (AUTH REQUIRED) =============
router.use(protect);

// Card creation flow
router.post("/create", createCard);
router.get("/status/:requestId", getCardCreationStatus);

// Card management
router.get("/", getUserCards);
router.get("/:cardId", getCardDetails);
router.get("/:cardId/balance", getCardBalance);
router.get("/:cardId/transactions", getCardTransactions);
router.get("/:cardId/budget", getCardBudgetStatus);
router.put("/:cardId/budget", updateCardBudget);

// Card funding
router.post("/fund", fundCard);
router.post("/unload", unloadCard);
router.post("/fund-from-wallet", fundUSDCardFromWallet);

// Card controls
router.post("/:cardId/freeze", freezeCard);
router.post("/:cardId/unfreeze", unfreezeCard);
router.post("/:cardId/pin", updateCardPin);
router.delete("/:cardId", deleteCard);

// Budget dashboard
router.get("/dashboard/budget", getBudgetDashboard);

export default router;
