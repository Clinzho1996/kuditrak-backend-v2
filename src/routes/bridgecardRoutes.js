// backend/routes/bridgecardRoutes.js
import express from "express";
import {
	cancelCard,
	createNGNCard,
	createNGNCardAsync,
	createPhysicalCard,
	createUSDCard,
	createVirtualCard,
	deleteCard,
	freezeCard,
	freezeNGNCard,
	fundIssuingWallet,
	fundNGNCard,
	fundUSDCard,
	getAllUserCards,
	getCardDetails,
	getCardTransactions,
	getIssuingWalletBalance,
	getNGNCardBalance,
	getNGNCardTransactions,
	getUSDCardBalance,
	toggleCardStatus,
	unfreezeCard,
	unfreezeNGNCard,
	unloadNGNCard,
	unloadUSDCard,
	updateCardPin,
} from "../controllers/bridgecardCardController.js";
import {
	deleteCardholder,
	getCardholderStatus,
	registerCardholder,
	updateCardholder,
} from "../controllers/bridgecardCardholderController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Cardholder routes
router.post("/cardholder/register", registerCardholder);
router.get("/cardholder/status", getCardholderStatus);
router.patch("/cardholder/update", updateCardholder);
router.delete("/cardholder/delete", deleteCardholder);

router.post("/wallet/fund", fundIssuingWallet);
router.get("/wallet/balance", getIssuingWalletBalance);

// Card routes
router.post("/virtual", createVirtualCard);
router.post("/physical", createPhysicalCard);
router.get("/all", getAllUserCards);
router.get("/:cardId", getCardDetails);
router.patch("/:cardId/toggle", toggleCardStatus);
router.delete("/:cardId", cancelCard);

// backend/routes/bridgecardRoutes.js - Add new routes

// USD Card routes
router.post("/usd/create", createUSDCard);
router.post("/usd/fund", fundUSDCard);
router.get("/usd/balance/:cardId", getUSDCardBalance);
router.post("/usd/unload", unloadUSDCard);

router.post("/ngn/create", createNGNCard);
router.post("/ngn/create-async", createNGNCardAsync);
router.post("/ngn/fund", fundNGNCard);
router.post("/ngn/unload", unloadNGNCard);

// Card management routes (existing)
router.post("/usd/freeze/:cardId", freezeCard);
router.post("/usd/unfreeze/:cardId", unfreezeCard);
router.get("/usd/transactions/:cardId", getCardTransactions);
router.delete("/usd/delete/:cardId", deleteCard);
router.post("/usd/pin/:cardId", updateCardPin);

router.get("/ngn/balance/:cardId", getNGNCardBalance); // Reuse USD balance
router.post("/ngn/freeze/:cardId", freezeNGNCard); // Reuse freeze
router.post("/ngn/unfreeze/:cardId", unfreezeNGNCard); // Reuse unfreeze
router.post("/ngn/pin/:cardId", updateCardPin); // Reuse PIN update
router.get("/ngn/transactions/:cardId", getNGNCardTransactions); // Reuse transactions
router.delete("/ngn/delete/:cardId", deleteCard); // Reuse dele

export default router;
