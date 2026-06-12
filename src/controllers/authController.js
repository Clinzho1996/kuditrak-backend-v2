import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import BankConnection from "../models/BankConnection.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";

import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import { sendEmail } from "../services/emailService.js";
import { verifyFirebaseToken } from "../services/firebaseService.js";
import { initializeDefaultCategories } from "./categoryController.js";

// Generate JWT
const generateToken = (userId) =>
	jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });

// Generate OTP
const generateOTP = () => {
	return Math.floor(100000 + Math.random() * 900000);
};
// Send OTP Email
const sendOTPEmail = async (email, otp, type = "verify") => {
	const subject =
		type === "verify" ? "Verify Your Email" : "Password Reset OTP";
	const message =
		type === "verify"
			? `<p>Your email verification OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`
			: `<p>Your password reset OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`;

	await sendEmail({
		to: email,
		subject,
		html: message,
	});
};
// Step 1: Signup
// controllers/authController.js
export const signup = async (req, res) => {
	console.log("\n=== Signup Controller ===");
	console.log("Request body:", req.body);
	console.log("Headers:", req.headers);

	try {
		const { fullName, email, password } = req.body;

		// Validate input
		if (!fullName || !email || !password) {
			return res.status(400).json({
				success: false,
				message: "Full name, email and password are required",
				code: "MISSING_FIELDS",
			});
		}

		const existing = await User.findOne({ email });
		if (existing) {
			return res.status(409).json({
				success: false,
				message: "An account with this email already exists",
				code: "EMAIL_ALREADY_EXISTS",
			});
		}

		console.log("Hashing password...");
		const hashedPassword = await bcrypt.hash(password, 10);

		console.log("Creating user...");
		const user = await User.create({
			fullName,
			email,
			password: hashedPassword,
		});

		await initializeDefaultCategories(user._id);
		console.log("User created with ID:", user._id);

		// Create local wallet
		await Wallet.create({
			userId: user._id,
		});

		// ========== CREATE ANCHOR CUSTOMER (TIER 0) ==========
		console.log("Creating Anchor customer for user:", user._id);

		let anchorCustomerCreated = false;
		let anchorError = null;

		try {
			const anchorResult = await getOrCreateAnchorCustomer(user._id);
			if (anchorResult.success) {
				anchorCustomerCreated = true;
				console.log(`✅ Anchor customer created: ${anchorResult.customerId}`);
				console.log(
					`   KYC Level: ${anchorResult.anchorCustomer?.kycLevel || "TIER_0"}`,
				);
			} else {
				anchorError = anchorResult.error;
				console.error(`❌ Failed to create Anchor customer: ${anchorError}`);
			}
		} catch (anchorErr) {
			anchorError = anchorErr.message;
			console.error("❌ Anchor customer creation error:", anchorErr);
			// Don't block signup - user can try again later
		}

		// Send OTP for email verification
		const otp = Math.floor(100000 + Math.random() * 900000);
		console.log("Generated OTP:", otp);

		user.otp = otp;
		user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 min expiry
		await user.save();
		console.log("OTP saved to user");

		console.log("Sending email...");
		await sendEmail({
			to: email,
			subject: "Verify Your Email",
			html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
		});
		console.log("Email sent successfully");

		// Prepare response message
		let responseMessage = "Signup successful, OTP sent";
		if (!anchorCustomerCreated) {
			responseMessage +=
				" (Banking profile will be set up when you complete KYC)";
		}

		res.status(201).json({
			success: true,
			message: responseMessage,
			userId: user._id,
			anchorCustomerCreated,
			anchorError: anchorError || null,
			nextSteps: anchorCustomerCreated
				? "Complete KYC to activate virtual cards and bank accounts"
				: "Your account is ready. Banking features will be available after KYC completion",
		});
	} catch (err) {
		console.error("ERROR in signup:", err);
		console.error("Error stack:", err.stack);
		res.status(500).json({
			success: false,
			message: "Unable to create account. Please try again",
			code: "SIGNUP_FAILED",
		});
	}
};

export const resendVerificationOtp = async (req, res) => {
	try {
		const { userId, email } = req.body;

		if (!userId && !email) {
			return res.status(400).json({
				success: false,
				message: "Either userId or email is required",
				code: "MISSING_FIELDS",
			});
		}

		let user;

		if (userId) {
			user = await User.findById(userId);
		} else if (email) {
			user = await User.findOne({ email });
		}

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
				code: "USER_NOT_FOUND",
			});
		}

		if (user.isVerified) {
			return res.status(400).json({
				success: false,
				message: "Account already verified",
				code: "ALREADY_VERIFIED",
			});
		}

		// Generate new OTP
		const otp = generateOTP();
		console.log("Resending OTP to:", user.email, "OTP:", otp);

		user.otp = otp;
		user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 min expiry
		await user.save();

		// Send email
		await sendOTPEmail(user.email, otp, "verify");

		res.status(200).json({
			success: true,
			message: "Verification code resent successfully",
		});
	} catch (err) {
		console.error("Resend OTP error:", err);
		res.status(500).json({
			success: false,
			message: "Unable to resend verification code. Please try again.",
			code: "RESEND_FAILED",
		});
	}
};
// Step 2: Confirm OTP
export const confirmOtp = async (req, res) => {
	try {
		const { userId, otp } = req.body;
		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
				code: "USER_NOT_FOUND",
			});
		}

		if (user.isVerified) {
			return res.status(400).json({
				success: false,
				message: "Account already verified",
				code: "ALREADY_VERIFIED",
			});
		}

		if (user.otp !== Number(otp) || Date.now() > user.otpExpires) {
			return res.status(400).json({
				success: false,
				message: "Invalid or expired OTP",
				code: "INVALID_OTP",
			});
		}

		user.isVerified = true;
		user.otp = undefined;
		user.otpExpires = undefined;
		await user.save();

		const token = generateToken(user._id);
		res.status(200).json({ message: "Email verified", token });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Forgot Password
export const forgotPassword = async (req, res) => {
	try {
		const { email } = req.body;

		if (!email) {
			return res.status(400).json({
				success: false,
				message: "Email is required",
				code: "EMAIL_REQUIRED",
			});
		}

		const user = await User.findOne({ email });
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "No account found with this email",
				code: "USER_NOT_FOUND",
			});
		}

		// Generate OTP
		const otp = Math.floor(100000 + Math.random() * 900000);

		user.resetOtp = otp;
		user.resetOtpExpires = Date.now() + 10 * 60 * 1000; // 10 mins
		await user.save();

		// Send email
		await sendEmail({
			to: email,
			subject: "Password Reset OTP",
			html: `<p>Your password reset OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
		});

		res.status(200).json({ message: "Reset OTP sent to email" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Verify Reset OTP
export const verifyResetOtp = async (req, res) => {
	try {
		const { email, otp } = req.body;

		if (!email || !otp) {
			return res.status(400).json({
				success: false,
				message: "Email and OTP are required",
				code: "MISSING_FIELDS",
			});
		}

		const user = await User.findOne({ email });
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
				code: "USER_NOT_FOUND",
			});
		}

		if (user.resetOtp !== Number(otp) || Date.now() > user.resetOtpExpires) {
			return res.status(400).json({
				success: false,
				message: "Invalid or expired OTP",
				code: "INVALID_OTP",
			});
		}

		// Mark OTP as verified (important)
		user.resetOtpVerified = true;
		await user.save();

		res.status(200).json({ message: "OTP verified successfully" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Resend Password Reset OTP
export const resendResetOtp = async (req, res) => {
	try {
		const { email } = req.body;

		if (!email) {
			return res.status(400).json({
				success: false,
				message: "Email is required",
				code: "EMAIL_REQUIRED",
			});
		}

		const user = await User.findOne({ email });
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "No account found with this email",
				code: "USER_NOT_FOUND",
			});
		}

		// Generate new OTP
		const otp = generateOTP();

		user.resetOtp = otp;
		user.resetOtpExpires = Date.now() + 10 * 60 * 1000; // 10 mins
		user.resetOtpVerified = false;
		await user.save();

		// Send email
		await sendOTPEmail(email, otp, "reset");

		res.status(200).json({
			success: true,
			message: "Reset OTP resent successfully",
		});
	} catch (err) {
		console.error("Resend reset OTP error:", err);
		res.status(500).json({
			success: false,
			message: "Unable to resend reset code. Please try again.",
			code: "RESEND_FAILED",
		});
	}
};
// Reset Password (after OTP verification)
export const resetPassword = async (req, res) => {
	try {
		const { email, newPassword } = req.body;

		if (!email || !newPassword) {
			return res.status(400).json({
				success: false,
				message: "Email and new password are required",
				code: "MISSING_FIELDS",
			});
		}

		const user = await User.findOne({ email });
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
				code: "USER_NOT_FOUND",
			});
		}

		// Ensure OTP was verified first
		if (!user.resetOtpVerified) {
			return res.status(401).json({
				success: false,
				message: "OTP verification required before resetting password",
				code: "OTP_NOT_VERIFIED",
			});
		}

		const hashedPassword = await bcrypt.hash(newPassword, 10);

		user.password = hashedPassword;

		// Clear reset fields
		user.resetOtp = undefined;
		user.resetOtpExpires = undefined;
		user.resetOtpVerified = undefined;

		await user.save();

		res.status(200).json({ message: "Password reset successful" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};
// Step 3: Complete onboarding journey
export const completeOnboarding = async (req, res) => {
	try {
		const {
			financialGoal,
			incomeType,
			incomeFrequency,
			financialChallenges,
			trackingHabit,
			bankConnections,
		} = req.body;

		// req.user is set by the protect middleware
		if (!req.user || !req.user._id) {
			return res.status(401).json({
				success: false,
				message: "Authentication required",
				code: "UNAUTHORIZED",
			});
		}

		const user = await User.findById(req.user._id);
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
				code: "USER_NOT_FOUND",
			});
		}

		// Update only fields that are provided, keep existing values for others
		user.onboarding = {
			...user.onboarding,
			financialGoals: financialGoal || user.onboarding?.financialGoals || [],
			incomeType: incomeType || user.onboarding?.incomeType || "Not specified",
			incomeFrequency:
				incomeFrequency || user.onboarding?.incomeFrequency || "Not specified",
			financialChallenges:
				financialChallenges || user.onboarding?.financialChallenges || [],
			expenseTrackingHabit:
				trackingHabit ||
				user.onboarding?.expenseTrackingHabit ||
				"Not specified",
		};

		user.onboardingCompleted = true;
		await user.save();

		// Save optional bank connections (only if provided)
		if (bankConnections && bankConnections.length > 0) {
			const connections = bankConnections.map((b) => ({
				userId: user._id,
				provider: b.provider,
				accountName: b.accountName,
				accountNumber: b.accountNumber,
				bankName: b.bankName,
				status: "Active",
				lastSync: null,
			}));
			await BankConnection.insertMany(connections);
			user.onboarding.connectedAccounts = true;
			await user.save();
		}

		res.status(200).json({ message: "Onboarding complete", user });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Login
export const login = async (req, res) => {
	try {
		const { email, password } = req.body;

		// Validate input
		if (!email || !password) {
			return res.status(400).json({
				success: false,
				message: "Email and password are required",
				code: "MISSING_FIELDS",
			});
		}

		// Find user
		const user = await User.findOne({ email });

		// User not found - suggest account creation
		if (!user) {
			return res.status(404).json({
				success: false,
				message:
					"No account found with this email address. Please create an account first.",
				code: "USER_NOT_FOUND",
				suggestSignup: true,
			});
		}

		// Verify password
		const isMatch = await bcrypt.compare(password, user.password);
		if (!isMatch) {
			return res.status(401).json({
				success: false,
				message: "Incorrect password. Please try again.",
				code: "INVALID_CREDENTIALS",
				remainingAttempts: "Reset password if you've forgotten",
			});
		}

		// Check if email is verified
		// if (!user.isVerified) {
		// 	return res.status(403).json({
		// 		success: false,
		// 		message:
		// 			"Please verify your email before logging in. A verification code was sent to your email.",
		// 		code: "EMAIL_NOT_VERIFIED",
		// 		email: user.email,
		// 		userId: user._id,
		// 		canResend: true,
		// 	});
		// }

		// Successful login
		const token = generateToken(user._id);

		// Remove sensitive data
		const userResponse = {
			_id: user._id,
			fullName: user.fullName,
			email: user.email,
			subscription: user.subscription,
			onboardingCompleted: user.onboardingCompleted,
			createdAt: user.createdAt,
		};

		res.status(200).json({
			success: true,
			message: "Login successful",
			token,
			user: userResponse,
		});
	} catch (err) {
		console.error("Login error:", err.message);
		res.status(500).json({
			success: false,
			message: "Unable to log in. Please try again later.",
			code: "SERVER_ERROR",
			error: err.message,
		});
	}
};

export const socialAuth = async (req, res) => {
	try {
		const { idToken, name, email, appleUserId } = req.body;

		if (!idToken) {
			return res.status(400).json({
				success: false,
				message: "Authentication token is required",
				code: "TOKEN_REQUIRED",
			});
		}

		const decoded = await verifyFirebaseToken(idToken);
		const { email: firebaseEmail, uid, firebase } = decoded;
		const userEmail = email || firebaseEmail;
		const authProvider = firebase.sign_in_provider || "apple.com";

		console.log(`🔐 Social auth attempt:`, {
			email: userEmail,
			provider: authProvider,
			firebaseUid: uid,
			hasAppleId: !!appleUserId,
		});

		// IMPORTANT: Only query by appleUserId if it actually exists
		let user = null;

		// Strategy 1: Find by Firebase UID
		user = await User.findOne({ firebaseUid: uid });
		if (user) {
			console.log(`✅ Found user by Firebase UID: ${user._id}`);
		}

		// Strategy 2: Find by Apple User ID (only if appleUserId is provided)
		if (!user && appleUserId) {
			user = await User.findOne({ appleUserId: appleUserId });
			if (user) {
				console.log(`✅ Found user by Apple ID: ${user._id}`);
			}
		}

		// Strategy 3: Find by email (only for social providers)
		if (!user && userEmail) {
			user = await User.findOne({
				email: userEmail,
				provider: { $in: ["google", "apple", "google.com", "apple.com"] },
			});
			if (user) {
				console.log(`✅ Found existing social user by email: ${user._id}`);
				if (!user.firebaseUid && uid) {
					user.firebaseUid = uid;
					await user.save();
				}
			}
		}

		// Create new user if not found
		let isNewUser = false;
		if (!user) {
			console.log(`🆕 Creating new ${authProvider} user...`);
			isNewUser = true;

			// Check for email conflict with local user
			const existingLocalUser = await User.findOne({
				email: userEmail,
				provider: "local",
			});

			let finalEmail = userEmail;
			if (existingLocalUser) {
				const [localPart, domain] = userEmail.split("@");
				finalEmail = `${localPart}+${authProvider.replace(".com", "")}@${domain}`;
				console.log(`⚠️ Email conflict, using: ${finalEmail}`);
			}

			let userName = name || "User";
			if (userName === "User" && userEmail) {
				userName = userEmail.split("@")[0];
			}

			try {
				// Prepare user data - CRITICAL: Only include appleUserId if it exists
				const userData = {
					fullName: userName,
					email: finalEmail,
					firebaseUid: uid,
					provider: authProvider,
					isVerified: true,
					onboardingCompleted: false,
				};

				// Only add appleUserId if it's actually provided (not null/undefined)
				if (appleUserId) {
					userData.appleUserId = appleUserId;
				}

				user = await User.create(userData);

				await initializeDefaultCategories(user._id);
				await Wallet.create({ userId: user._id });

				console.log(
					`✅ New ${authProvider} user created: ${userName} (${finalEmail})`,
				);
			} catch (createError) {
				if (createError.code === 11000) {
					console.error(`❌ Duplicate key error:`, createError.keyPattern);

					// Try to find by Firebase UID one more time
					const retryUser = await User.findOne({ firebaseUid: uid });
					if (retryUser) {
						user = retryUser;
						console.log(`✅ Found user on retry: ${user._id}`);
						isNewUser = false;
					} else {
						return res.status(409).json({
							success: false,
							message:
								"Account already exists with different provider. Please sign in with your original method.",
							code: "ACCOUNT_EXISTS",
							details: createError.keyPattern,
						});
					}
				} else {
					throw createError;
				}
			}
		}

		// Update existing user
		if (user) {
			let needsUpdate = false;

			if (
				(user.fullName === "User" || !user.fullName) &&
				name &&
				name !== "User"
			) {
				user.fullName = name;
				needsUpdate = true;
			}

			// Only update appleUserId if it's provided and user doesn't have one
			if (appleUserId && !user.appleUserId) {
				user.appleUserId = appleUserId;
				needsUpdate = true;
				console.log(`🔗 Linking Apple ID: ${appleUserId}`);
			}

			if (!user.firebaseUid && uid) {
				user.firebaseUid = uid;
				needsUpdate = true;
			}

			if (needsUpdate) {
				await user.save();
			}

			// ========== CREATE/VERIFY ANCHOR CUSTOMER ==========
			let anchorCustomerCreated = false;
			let anchorKycLevel = null;

			// Only attempt Anchor customer creation for new users or users without Anchor ID
			if (isNewUser || !user.anchorCustomerId) {
				console.log(`🏦 Creating Anchor customer for social user: ${user._id}`);

				try {
					const anchorResult = await getOrCreateAnchorCustomer(user._id);
					if (anchorResult.success) {
						anchorCustomerCreated = true;
						anchorKycLevel = anchorResult.anchorCustomer?.kycLevel || "TIER_0";
						console.log(
							`✅ Anchor customer created: ${anchorResult.customerId} (${anchorKycLevel})`,
						);
					} else {
						console.error(
							`❌ Failed to create Anchor customer: ${anchorResult.error}`,
						);
					}
				} catch (anchorErr) {
					console.error("❌ Anchor customer creation error:", anchorErr);
					// Don't block login - user can try KYC later
				}
			} else {
				// User already has Anchor customer
				anchorCustomerCreated = true;
				anchorKycLevel = user.anchorKycLevel;
				console.log(
					`✅ User already has Anchor customer: ${user.anchorCustomerId}`,
				);
			}

			const token = generateToken(user._id);
			const userResponse = {
				_id: user._id,
				fullName: user.fullName,
				email: user.email,
				subscription: user.subscription,
				onboardingCompleted: user.onboardingCompleted,
				profileImage: user.profileImage,
				createdAt: user.createdAt,
				anchorCustomerId: user.anchorCustomerId,
				anchorKycLevel: anchorKycLevel,
			};

			return res.status(200).json({
				success: true,
				token,
				user: userResponse,
				firstLogin: !user.onboardingCompleted,
				anchorSetup: {
					completed: anchorCustomerCreated,
					kycLevel: anchorKycLevel,
					requiresKYC: anchorKycLevel === "TIER_0",
				},
			});
		}

		throw new Error("User creation failed");
	} catch (err) {
		console.error("❌ Social auth error:", err);
		res.status(500).json({
			success: false,
			message: err.message,
			code: "SOCIAL_AUTH_FAILED",
		});
	}
};

// Add to userController.js
export const retryAnchorCustomerCreation = async (req, res) => {
	try {
		const userId = req.user._id;

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
			});
		}

		// Check if already has Anchor customer
		if (user.anchorCustomerId) {
			return res.status(400).json({
				success: false,
				message: "Anchor customer already exists",
				anchorCustomerId: user.anchorCustomerId,
				kycLevel: user.anchorKycLevel,
			});
		}

		console.log(`🔄 Retrying Anchor customer creation for user: ${userId}`);

		// Try to create Anchor customer
		const anchorResult = await getOrCreateAnchorCustomer(userId);

		if (!anchorResult.success) {
			return res.status(400).json({
				success: false,
				message: "Failed to create Anchor customer",
				error: anchorResult.error,
				requiresSupport: true,
			});
		}

		// Refresh user data
		const updatedUser = await User.findById(userId);

		res.status(200).json({
			success: true,
			message: "Anchor customer created successfully",
			anchorCustomerId: anchorResult.customerId,
			kycLevel: updatedUser?.anchorKycLevel || "TIER_0",
			nextSteps: "Complete KYC to activate virtual cards and bank accounts",
		});
	} catch (error) {
		console.error("❌ Retry Anchor customer creation error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
			code: "ANCHOR_SETUP_FAILED",
		});
	}
};

// Get Anchor customer status
export const getAnchorCustomerStatus = async (req, res) => {
	try {
		const userId = req.user._id;

		const user = await User.findById(userId).select(
			"anchorCustomerId anchorCustomerStatus anchorKycLevel kyc",
		);

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
			});
		}

		// If user has Anchor customer ID but no status, try to fetch from Anchor
		if (user.anchorCustomerId && !user.anchorCustomerStatus) {
			try {
				const { getCustomerKYCStatus } =
					await import("../services/anchorCustomerService.js");
				const kycStatus = await getCustomerKYCStatus(userId);
				if (kycStatus.success) {
					user.anchorKycLevel = kycStatus.kycLevel;
					user.anchorCustomerStatus = kycStatus.kycStatus;
					await user.save();
				}
			} catch (err) {
				console.error("Failed to fetch Anchor status:", err);
			}
		}

		res.status(200).json({
			success: true,
			anchorCustomer: {
				hasAnchorCustomer: !!user.anchorCustomerId,
				customerId: user.anchorCustomerId,
				status: user.anchorCustomerStatus || "pending",
				kycLevel: user.anchorKycLevel || "TIER_0",
				kycVerified: user.kyc?.isVerified || false,
			},
			requiresAction:
				!user.anchorCustomerId || user.anchorKycLevel === "TIER_0",
			nextSteps: !user.anchorCustomerId
				? "Complete KYC to set up your banking profile"
				: user.anchorKycLevel === "TIER_0"
					? "Complete KYC to upgrade to Tier 1 for card access"
					: "Your banking profile is active",
		});
	} catch (error) {
		console.error("Get Anchor customer status error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};
