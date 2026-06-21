// routes/requestRoutes.js
import express from "express";
import {
	createRequest,
	getUserRequests,
	respondToRequest,
} from "../controllers/requestController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.post("/", createRequest);
router.get("/", getUserRequests);
router.post("/respond", respondToRequest);

export default router;
