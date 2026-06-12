// backend/routes/anchorCustomerRoutes.js
import express from "express";
import {
	createAnchorCustomer,
	getCustomerDetails,
	getCustomerStatus,
	getKYCStatus,
	submitKYCVerification,
	syncCustomerWithAnchor,
	upgradeKYC,
} from "../controllers/anchorCustomerController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.use(protect); // All routes require authentication

router.post("/", createAnchorCustomer);
router.get("/status", getCustomerStatus);
router.get("/details", getCustomerDetails);
router.post("/sync", syncCustomerWithAnchor);
// backend/routes/anchorCustomerRoutes.js
router.post("/kyc/submit-verification", submitKYCVerification);
router.post("/kyc/upgrade", upgradeKYC);
router.get("/kyc/status", getKYCStatus);

export default router;
