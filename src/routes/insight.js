import express from "express";
import { getUserInsights } from "../controllers/insightController.js";
import protect from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

router.get("/", getUserInsights);

export default router;
