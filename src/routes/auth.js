// routes/auth.js
import express from "express";
import {
	completeOnboarding,
	confirmOtp,
	forgotPassword,
	login,
	resendResetOtp,
	resendVerificationOtp,
	resetPassword,
	signup,
	socialAuth,
	verifyResetOtp,
} from "../controllers/authController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

console.log("=== Auth Routes Debug ===");
console.log("protect type:", typeof protect); // Should be 'function'
console.log("protect itself:", protect); // Should show [AsyncFunction: protect]
console.log("completeOnboarding type:", typeof completeOnboarding);

// Step 1: Sign up
router.post("/signup", signup);

// Step 2: Confirm OTP
router.post("/confirm-otp", confirmOtp);

// Login
router.post("/login", login);
router.post("/social-auth", socialAuth);
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp", verifyResetOtp);
router.post("/resend-otp", resendVerificationOtp);
router.post("/resend-reset-otp", resendResetOtp);
router.post("/reset-password", resetPassword);

// Step 3: Complete onboarding journey (after verification)
router.post("/onboarding", protect, completeOnboarding);

// Add a test route to verify middleware
router.get("/test-protect", protect, (req, res) => {
	console.log("Test route reached successfully");
	res.json({ message: "Protect middleware working", user: req.user.email });
});

export default router;
