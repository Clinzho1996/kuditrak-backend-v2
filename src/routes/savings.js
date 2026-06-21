import express from "express";
import {
	allocateToGoal,
	commitToGoal,
	createGoal,
	deleteGoal,
	getGoalById,
	getGoalStats,
	getGoalTransactions,
	listGoals,
	releaseFromCommitment,
	toggleAutoAllocate,
	updateGoal,
	withdrawDesignatedFunds,
} from "../controllers/userGoalController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Goal CRUD operations
router.post("/", createGoal); // Create a new goal
router.get("/", listGoals); // List all user goals
router.get("/:id", getGoalById); // Get single goal by ID
router.get("/:id/stats", getGoalStats); // Get goal statistics with commitment info
router.put("/:id", updateGoal); // Update goal details
router.delete("/:id", deleteGoal); // Delete a goal

// Fund management (CBN-compliant terminology)
router.post("/:id/allocate", allocateToGoal); // Designate funds to goal (was: credit)
router.post("/:id/withdraw", withdrawDesignatedFunds); // Release designated funds (was: withdraw)

// routes/savingsRoutes.js
router.get("/:id/transactions", getGoalTransactions);
// Commitment management (was: lock/unlock)
router.post("/:id/commit", commitToGoal); // Commit to goal with release date
router.post("/:id/release", releaseFromCommitment); // Release from commitment

// Auto-allocation settings (was: auto-save)
router.patch("/:id/toggle-auto", toggleAutoAllocate); // Enable/disable auto-allocation

export default router;
