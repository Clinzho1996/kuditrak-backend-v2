// routes/groupSavingsRoutes.js
import express from "express";
import {
	contributeToGroup,
	createGroup,
	getGroupContributions,
	getGroupDetails,
	getGroupMembers,
	getGroupPayouts,
	getUserGroups,
	joinGroup,
	leaveGroup,
	processPayoutManually,
	removeMember,
	updateGroup,
} from "../controllers/groupSavingsController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// ==================== GROUP MANAGEMENT ====================

/**
 * Create a new group savings circle
 * @route POST /api/groups/create
 * @body { name, description, frequency, contributionAmount, maxMembers, payoutOrder, payoutSchedule, isPrivate, inviteOnly, icon, color }
 */
router.post("/create", createGroup);

/**
 * Get all groups the user is a member of
 * @route GET /api/groups/my-groups
 */
router.get("/my-groups", getUserGroups);

/**
 * Get details of a specific group
 * @route GET /api/groups/:groupId
 */
router.get("/:groupId", getGroupDetails);

/**
 * Update group settings
 * @route PUT /api/groups/:groupId
 * @body { name, description, maxMembers, payoutOrder, payoutSchedule, icon, color }
 */
router.put("/:groupId", updateGroup);

// ==================== MEMBERSHIP ====================

/**
 * Join a group using group code
 * @route POST /api/groups/join
 * @body { groupCode }
 */
router.post("/join", joinGroup);

/**
 * Leave a group
 * @route POST /api/groups/:groupId/leave
 */
router.post("/:groupId/leave", leaveGroup);

/**
 * Get all members of a group
 * @route GET /api/groups/:groupId/members
 */
router.get("/:groupId/members", getGroupMembers);

/**
 * Remove a member from a group (admin only)
 * @route DELETE /api/groups/:groupId/members/:memberId
 */
router.delete("/:groupId/members/:memberId", removeMember);

// ==================== CONTRIBUTIONS ====================

/**
 * Make a contribution to a group
 * @route POST /api/groups/contribute
 * @body { groupId, amount }
 */
router.post("/contribute", contributeToGroup);

/**
 * Get all contributions for a group
 * @route GET /api/groups/:groupId/contributions
 * @query { limit, offset }
 */
router.get("/:groupId/contributions", getGroupContributions);

// ==================== PAYOUTS ====================

/**
 * Get all payouts for a group
 * @route GET /api/groups/:groupId/payouts
 * @query { limit, offset }
 */
router.get("/:groupId/payouts", getGroupPayouts);

/**
 * Manually trigger payout for a group (admin only)
 * @route POST /api/groups/:groupId/payout
 */
router.post("/:groupId/payout", processPayoutManually);

export default router;
