// backend/routes/anchorCardRoutes.js
import express from "express";
import {
	cancelCard,
	createVirtualCard,
	getCardDetails,
	getCardTransactions,
	getUserCards,
	toggleCardStatus,
} from "../controllers/anchorCardController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.get("/", getUserCards);
router.post("/virtual", createVirtualCard);
router.get("/:cardId", getCardDetails);
router.get("/:cardId/transactions", getCardTransactions);
router.patch("/:cardId/toggle", toggleCardStatus);
router.delete("/:cardId", cancelCard);

export default router;
