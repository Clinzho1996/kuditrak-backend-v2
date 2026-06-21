// routes/groupSavingsRoutes.js
import express from "express";
import {
	contributeToGroup,
	createGroup,
	getGroupDetails,
	getUserGroups,
	joinGroup,
	leaveGroup,
} from "../controllers/groupSavingsController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Group CRUD
router.post("/create", createGroup);
router.get("/my-groups", getUserGroups);
router.get("/:groupId", getGroupDetails);

// Membership
router.post("/join", joinGroup);
router.post("/:groupId/leave", leaveGroup);

// Contributions
router.post("/contribute", contributeToGroup);

export default router;
