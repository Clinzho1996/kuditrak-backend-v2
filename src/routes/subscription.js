// backend/routes/subscriptionRoutes.js
import express from "express";
import {
	cleanDatabase,
	forceSyncSubscription,
	getSubscription,
	linkRevenueCatId,
	syncSubscription,
} from "../controllers/subscriptionController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Public webhook endpoint (no auth required)
// router.post("/webhook/revenuecat", handleRevenueCatWebhook);

// Protected routes
router.use(protect); // All routes below require authentication

router.get("/", getSubscription);
router.post("/sync", syncSubscription);
router.post("/link-revenuecat", linkRevenueCatId);
router.post("/force-sync", forceSyncSubscription);
router.post("/clean", cleanDatabase);

export default router;
