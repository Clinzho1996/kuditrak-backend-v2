// backend/routes/pinRoutes.js
import express from "express";
import {
	checkPinStatus,
	resetTransactionPin,
	setTransactionPin,
	updateTransactionPin,
	verifyTransactionPin,
} from "../controllers/pinController.js";
import protect from "../middleware/auth.js";
protect;

const router = express.Router();

router.post("/set", protect, setTransactionPin);
router.put("/update", protect, updateTransactionPin);
router.post("/verify", protect, verifyTransactionPin);
router.get("/status", protect, checkPinStatus);
router.post("/reset", protect, resetTransactionPin);

export default router;
