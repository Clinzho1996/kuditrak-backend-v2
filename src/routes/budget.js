import express from "express";
import {
	createBudget,
	deleteBudget,
	getBudgetById,
	getBudgetInsights,
	getBudgets,
	getTotalBudgetInsights,
	updateBudget,
} from "../controllers/budgetController.js";
import protect from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

router.post("/", createBudget);
router.get("/", getBudgets);
router.get("/total", getTotalBudgetInsights);
router.patch("/:id", updateBudget);
router.delete("/:id", deleteBudget);
router.get("/:id", getBudgetById);
router.get("/:id/insights", getBudgetInsights);

export default router;
